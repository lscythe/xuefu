import { afterEach, describe, expect, test } from "bun:test";
import { RGBA } from "@opentui/core";
import type { TestRendererSetup } from "@opentui/core/testing";
import { testRender } from "@opentui/solid";
import { createSignal, Show } from "solid-js";
import type { AppError } from "../../../../src/application/errors";
import { cancelled, processError } from "../../../../src/domain/shared/errors";
import type { WorkspaceId } from "../../../../src/domain/shared/ids";
import type { AbsolutePath } from "../../../../src/domain/shared/path";
import { err, ok, type Result } from "../../../../src/domain/shared/result";
import type { Timestamp } from "../../../../src/domain/shared/time";
import type { Workspace, WorkspaceName } from "../../../../src/domain/workspace/workspace";
import type { GitClient, GitFiles } from "../../../../src/plugins/git/application/git-client";
import type { GitStatus } from "../../../../src/plugins/git/domain/status";
import {
  branchBadge,
  fitRows,
  type GitSectionActions,
  gitView,
  type StatusRow,
  stageAll,
  statusRows,
} from "../../../../src/plugins/git/tui/git-view";
import { PALETTE } from "../../../../src/tui/theme/palette";
import { fakeGit } from "../../../support/fake-git";

const MOBILE: Workspace = {
  id: "mobile" as WorkspaceId,
  name: "Mobile" as WorkspaceName,
  path: "/work/mobile" as AbsolutePath,
  group: null,
  addedAt: 0 as Timestamp,
  lastActiveAt: null,
};

const CLEAN: GitStatus = {
  branch: "main",
  commit: "1a2b3c4d5e6f",
  upstream: "origin/main",
  ahead: 0,
  behind: 0,
  changes: [],
  conflicts: [],
  untracked: [],
  stashes: 0,
};

const DIRTY: GitStatus = {
  ...CLEAN,
  ahead: 2,
  changes: [
    { path: "src/app.ts", from: null, staged: "modified", unstaged: "unchanged" },
    { path: "src/new.ts", from: "src/old.ts", staged: "renamed", unstaged: "unchanged" },
    { path: "README.md", from: null, staged: "unchanged", unstaged: "modified" },
  ],
  conflicts: ["merge.ts"],
  untracked: ["notes.txt"],
};

type Read = Awaited<ReturnType<GitClient["status"]>>;

/** A client whose answers the test sets, one read at a time. */
function fakeClient(first: Read) {
  let answer = first;
  const signals: AbortSignal[] = [];
  let pending: ((read: Read) => void) | null = null;
  let hold = false;
  const client = fakeGit({
    status: (_folder, signal) => {
      if (signal !== undefined) signals.push(signal);
      if (hold) return new Promise((resolve) => (pending = resolve));
      return Promise.resolve(answer);
    },
  });
  return {
    client,
    signals,
    answer: (next: Read) => {
      answer = next;
    },
    hold: () => {
      hold = true;
    },
    release: (read: Read) => {
      hold = false;
      pending?.(read);
    },
  };
}

let setup: TestRendererSetup | undefined;
afterEach(() => {
  setup?.renderer.destroy();
  setup = undefined;
});

/** Section actions that answer as the test says, remembering what they were asked. */
function fakeActions() {
  const calls: { op: string; folder: string; arg: GitFiles | string }[] = [];
  let answer: Result<unknown, AppError> = ok(undefined);
  let commitSignal: AbortSignal | null = null;
  let holdCommit = false;
  const actions: GitSectionActions = {
    stage: (folder, files) => {
      calls.push({ op: "stage", folder, arg: files });
      return Promise.resolve(answer);
    },
    unstage: (folder, files) => {
      calls.push({ op: "unstage", folder, arg: files });
      return Promise.resolve(answer);
    },
    commit: (folder, message, signal) => {
      calls.push({ op: "commit", folder, arg: message });
      commitSignal = signal;
      if (holdCommit) {
        return new Promise((resolve) =>
          signal.addEventListener("abort", () => resolve(err(cancelled("Commit was cancelled")))),
        );
      }
      return Promise.resolve(
        answer.ok ? ok({ commit: "1a2b3c4d5e6f", subject: message.split("\n")[0] ?? "" }) : answer,
      );
    },
  };
  return {
    actions,
    calls,
    fail: (error: AppError) => {
      answer = err(error);
    },
    holdCommit: () => {
      holdCommit = true;
    },
    commitSignal: () => commitSignal,
  };
}

async function render(
  client: GitClient,
  options: {
    workspace?: Workspace | null;
    focused?: boolean;
    actions?: GitSectionActions;
    rows?: number;
  } = {},
) {
  const statuses: (string | null)[] = [];
  const keys: (string | null)[] = [];
  const modal: boolean[] = [];
  const reports: AppError[] = [];
  const [shown, setShown] = createSignal(true);
  const [focused, setFocused] = createSignal(options.focused ?? false);
  const View = gitView(client, options.actions ?? fakeActions().actions, 30);
  setup = await testRender(
    () => (
      <box width="100%" height="100%" flexDirection="column">
        <Show when={shown()}>
          <View
            workspace={options.workspace === undefined ? MOBILE : options.workspace}
            width={60}
            rows={options.rows ?? 12}
            icons="unicode"
            focused={focused()}
            setStatus={(status) => statuses.push(status)}
            setKeys={(next) => keys.push(next)}
            setModal={(open) => modal.push(open)}
            report={(error) => reports.push(error)}
          />
        </Show>
      </box>
    ),
    { width: 64, height: 20 },
  );
  await setup.renderOnce();
  return Object.assign(setup, {
    statuses,
    keys,
    modal,
    reports,
    close: () => setShown(false),
    focus: (on: boolean) => setFocused(on),
  });
}

/** A lone ESC is only reported once the parser is sure no escape sequence follows. */
async function pressEsc(view: TestRendererSetup) {
  view.mockInput.pressEscape();
  await Bun.sleep(30);
}

describe("statusRows", () => {
  test("the branch, then conflicts, staged, unstaged and untracked under their headings", () => {
    const rows = statusRows(DIRTY, false).map((row) =>
      row.kind === "file" ? `${row.letter} ${row.path}` : row.text,
    );
    expect(rows).toEqual([
      "On main, 2 commits ahead of origin/main",
      "",
      "Conflicts (1)",
      "U merge.ts",
      "",
      "Staged (2)",
      "M src/app.ts",
      "R src/new.ts ← src/old.ts",
      "",
      "Not staged (1)",
      "M README.md",
      "",
      "Untracked (1)",
      "? notes.txt",
    ]);
    expect(statusRows(DIRTY, true).some((row) => "path" in row && row.path.includes(" <- "))).toBe(
      true,
    );
  });

  test("a clean tree says so", () => {
    expect(statusRows(CLEAN, false).map((row) => ("text" in row ? row.text : ""))).toEqual([
      "On main, up to date with origin/main",
      "",
      "Nothing to commit, working tree clean.",
    ]);
  });
});

describe("fitRows", () => {
  test("keeps every row that fits, and says how many more there are when some do not", () => {
    const rows = statusRows(DIRTY, false);
    expect(fitRows(rows, 20)).toEqual(rows);
    const fitted = fitRows(rows, 5);
    expect(fitted).toHaveLength(5);
    expect(fitted[4]).toEqual({ kind: "text", text: "… and 10 more", tone: "textMuted" });
  });
});

describe("branchBadge", () => {
  test.each([
    [CLEAN, false, "main"],
    [{ ...CLEAN, ahead: 2, behind: 1 }, false, "main ↑2 ↓1"],
    [{ ...CLEAN, ahead: 2, behind: 1 }, true, "main +2 -1"],
    [{ ...CLEAN, branch: null }, false, "detached 1a2b3c4"],
    [{ ...CLEAN, branch: null, commit: null }, false, "detached"],
  ] as [GitStatus, boolean, string][])("%# → %s", (status, ascii, badge) => {
    expect(branchBadge(status, ascii)).toBe(badge);
  });
});

describe("gitView", () => {
  test("shows the status with the branch set into the frame", async () => {
    const fake = fakeClient(ok(DIRTY));
    const view = await render(fake.client);
    const frame = await view.waitForFrame((f) => f.includes("Conflicts (1)"));
    expect(frame).toContain("On main, 2 commits ahead of origin/main");
    expect(frame).toContain("R  src/new.ts ← src/old.ts");
    expect(view.statuses.at(-1)).toBe("main ↑2");
  });

  test("says it is reading until the first answer", async () => {
    const fake = fakeClient(ok(CLEAN));
    fake.hold();
    const view = await render(fake.client);
    expect(view.captureCharFrame()).toContain("Reading git status...");
    fake.release(ok(CLEAN));
    await view.waitForFrame((f) => f.includes("working tree clean"));
  });

  test("reads again while open, never two at once, and stops when closed", async () => {
    const fake = fakeClient(ok(CLEAN));
    const view = await render(fake.client);
    await view.waitForFrame((f) => f.includes("working tree clean"));
    fake.answer(ok({ ...CLEAN, untracked: ["new.txt"] }));
    await Bun.sleep(60);
    await view.waitForFrame((f) => f.includes("?  new.txt"));

    fake.hold();
    const before = fake.signals.length;
    await Bun.sleep(100);
    expect(fake.signals.length).toBe(before + 1);

    view.close();
    await view.renderOnce();
    expect(fake.signals.at(-1)?.aborted).toBe(true);
    await Bun.sleep(80);
    expect(fake.signals.length).toBe(before + 1);
  });

  test("outside a repository it says so, with no status in the frame", async () => {
    const view = await render(fakeClient(ok(null)).client);
    await view.waitForFrame((f) => f.includes("Mobile is not a git repository."));
    expect(view.statuses.at(-1)).toBeNull();
  });

  test("a failed read is shown as an error", async () => {
    const failed = err(processError("git status failed: bad index", "git", 128));
    const view = await render(fakeClient(failed).client);
    await view.waitForFrame((f) => f.includes("✗ git status failed: bad index"));
  });

  test("with no workspace open it says how to open one, and reads nothing", async () => {
    const fake = fakeClient(ok(CLEAN));
    const view = await render(fake.client, { workspace: null });
    expect(view.captureCharFrame()).toContain("Open a workspace with Ctrl+W");
    expect(fake.signals).toHaveLength(0);
  });

  test("long lists end with how many more there are", async () => {
    const many = Array.from({ length: 30 }, (_, i) => `file-${i}.txt`);
    const view = await render(fakeClient(ok({ ...CLEAN, untracked: many })).client);
    const frame = await view.waitForFrame((f) => f.includes("more"));
    expect(frame).toContain("… and 22 more");
  });
});

const WORKING: GitStatus = {
  ...CLEAN,
  changes: [
    { path: "src/app.ts", from: null, staged: "modified", unstaged: "unchanged" },
    { path: "README.md", from: null, staged: "unchanged", unstaged: "modified" },
  ],
  untracked: ["notes.txt"],
};

describe("statusRows files", () => {
  test("say which list they are in, and a staged rename names both its sides", () => {
    const files = statusRows(DIRTY, false).flatMap((row) =>
      row.kind === "file" ? [[row.side, row.files]] : [],
    );
    expect(files).toEqual([
      ["conflict", ["merge.ts"]],
      ["staged", ["src/app.ts"]],
      ["staged", ["src/new.ts", "src/old.ts"]],
      ["unstaged", ["README.md"]],
      ["untracked", ["notes.txt"]],
    ]);
  });
});

describe("fitRows with a selection", () => {
  test("keeps the selected row in view instead of cutting the list short", () => {
    const rows = statusRows(
      { ...CLEAN, untracked: Array.from({ length: 30 }, (_, i) => `f${i}`) },
      false,
    );
    const window = fitRows(rows, 5, 20);
    expect(window).toHaveLength(5);
    expect(window).toContain(rows[20] as StatusRow);
    expect(window.some((row) => row.kind === "text" && row.text.includes("more"))).toBe(false);
  });
});

describe("stageAll", () => {
  test.each([
    [WORKING, { stage: true, files: "all" }],
    [
      { ...WORKING, conflicts: ["merge.ts"] },
      { stage: true, files: ["README.md", "notes.txt"] },
    ],
    [
      { ...WORKING, changes: [WORKING.changes[0]], untracked: [] },
      { stage: false, files: "all" },
    ],
    [CLEAN, null],
  ] as [GitStatus, unknown][])("%#", (status, expected) => {
    expect(stageAll(status)).toEqual(expected as never);
  });
});

describe("gitView with the keyboard", () => {
  test("idle, it shows no cursor and sets no keys", async () => {
    const view = await render(fakeClient(ok(WORKING)).client);
    await view.waitForFrame((f) => f.includes("Untracked (1)"));
    expect(view.keys.at(-1)).toBeNull();
    view.mockInput.pressKey(" ");
    await view.renderOnce();
    expect(view.keys.filter((keys) => keys !== null)).toEqual([]);
  });

  test("focused, the keys follow the file under the cursor", async () => {
    const view = await render(fakeClient(ok(WORKING)).client, { focused: true });
    await view.waitForFrame((f) => f.includes("Untracked (1)"));
    expect(view.keys.at(-1)).toBe("space unstage · a stage all · c commit");
    view.mockInput.pressKey("j");
    await view.renderOnce();
    expect(view.keys.at(-1)).toBe("space stage · a stage all · c commit");
    view.mockInput.pressArrow("down");
    view.mockInput.pressArrow("down");
    await view.renderOnce();
    expect(view.keys.at(-1)).toBe("space unstage · a stage all · c commit");
    view.mockInput.pressKey("k");
    view.focus(false);
    await view.renderOnce();
    expect(view.keys.at(-1)).toBeNull();
  });

  test("space stages or unstages the file under the cursor, then reads status again", async () => {
    const fake = fakeClient(ok(WORKING));
    const changes = fakeActions();
    const view = await render(fake.client, { focused: true, actions: changes.actions });
    await view.waitForFrame((f) => f.includes("Untracked (1)"));
    const reads = fake.signals.length;
    view.mockInput.pressKey(" ");
    await Bun.sleep(5);
    view.mockInput.pressKey("END");
    view.mockInput.pressKey(" ");
    await Bun.sleep(5);
    expect(changes.calls).toEqual([
      { op: "unstage", folder: MOBILE.path, arg: ["src/app.ts"] },
      { op: "stage", folder: MOBILE.path, arg: ["notes.txt"] },
    ]);
    expect(fake.signals.length).toBeGreaterThan(reads);
  });

  test("a stages every change, and a failure is reported", async () => {
    const changes = fakeActions();
    changes.fail(processError("git add failed: index.lock exists", "git", 128));
    const view = await render(fakeClient(ok(WORKING)).client, {
      focused: true,
      actions: changes.actions,
    });
    await view.waitForFrame((f) => f.includes("Untracked (1)"));
    view.mockInput.pressKey("a");
    await Bun.sleep(5);
    expect(changes.calls).toEqual([{ op: "stage", folder: MOBILE.path, arg: "all" }]);
    expect(view.reports.map((error) => error.message)).toEqual([
      "git add failed: index.lock exists",
    ]);
  });

  test("the cursor's row is lit", async () => {
    const view = await render(fakeClient(ok(WORKING)).client, { focused: true });
    await view.waitForFrame((f) => f.includes("Untracked (1)"));
    const lit = view
      .captureSpans()
      .lines.flatMap((line) => line.spans)
      .filter((span) => span.bg.equals(RGBA.fromHex(PALETTE.selectionBg)))
      .map((span) => span.text)
      .join("");
    expect(lit.trim()).toStartWith("M  src/app.ts");
  });
});

describe("gitView commits", () => {
  const editorOpen = (f: string) => f.includes("ctrl+s commit 1 file  esc close");

  async function writing(changes = fakeActions(), status: GitStatus = WORKING) {
    const view = await render(fakeClient(ok(status)).client, {
      focused: true,
      actions: changes.actions,
    });
    await view.waitForFrame((f) => f.includes("Staged (1)"));
    view.mockInput.pressKey("c");
    await view.waitForFrame((f) => f.includes(" Commit on main ") && editorOpen(f));
    return view;
  }

  test("c opens the editor with every key its own; ctrl+s commits and says so", async () => {
    const changes = fakeActions();
    const view = await writing(changes);
    expect(view.modal).toEqual([true]);
    expect(view.captureCharFrame()).not.toContain(" Commit on main c");
    await view.mockInput.typeText("Fix login");
    view.mockInput.pressKey("s", { ctrl: true });
    const frame = await view.waitForFrame((f) => f.includes("✓ Committed 1a2b3c4 Fix login"));
    expect(editorOpen(frame)).toBe(false);
    expect(changes.calls).toEqual([{ op: "commit", folder: MOBILE.path, arg: "Fix login" }]);
    expect(view.modal).toEqual([true, false]);
  });

  test("esc closes it and keeps the message for next time", async () => {
    const view = await writing();
    await view.mockInput.typeText("Half a thought");
    await pressEsc(view);
    await view.waitForFrame((f) => !editorOpen(f));
    view.mockInput.pressKey("c");
    await view.waitForFrame((f) => editorOpen(f) && f.includes("Half a thought"));
  });

  test("a blank message is refused before git is asked", async () => {
    const changes = fakeActions();
    const view = await writing(changes);
    view.mockInput.pressKey("s", { ctrl: true });
    await view.waitForFrame((f) => f.includes("Commit message is invalid: write a summary"));
    expect(changes.calls).toEqual([]);
  });

  test("a refusal stays in the editor; esc stops a commit still running", async () => {
    const refused = fakeActions();
    refused.fail(processError("git commit failed: tests failed", "git", 1));
    const view = await writing(refused);
    await view.mockInput.typeText("Fix");
    view.mockInput.pressKey("s", { ctrl: true });
    await view.waitForFrame(
      (f) => f.includes("✗ git commit failed: tests failed") && editorOpen(f),
    );

    view.renderer.destroy();
    const slow = fakeActions();
    slow.holdCommit();
    const again = await writing(slow);
    await again.mockInput.typeText("Fix");
    again.mockInput.pressKey("s", { ctrl: true });
    await again.waitForFrame((f) => f.includes("Committing... hooks may take a while"));
    await pressEsc(again);
    await again.waitForFrame((f) => f.includes("✗ Commit was cancelled"));
    expect(slow.commitSignal()?.aborted).toBe(true);
  });

  test("with conflicts, or nothing staged, c does nothing", async () => {
    const view = await render(fakeClient(ok({ ...WORKING, conflicts: ["merge.ts"] })).client, {
      focused: true,
    });
    await view.waitForFrame((f) => f.includes("Conflicts (1)"));
    view.mockInput.pressKey("c");
    await view.renderOnce();
    expect(view.modal).toEqual([]);
    expect(view.keys.at(-1)).toBe("space stage · a stage all");
  });

  test("a summary longer than 72 characters is pointed out", async () => {
    const view = await writing();
    await view.mockInput.typeText("x".repeat(80));
    await view.waitForFrame((f) => f.includes("Summary is 80 characters"));
  });
});
