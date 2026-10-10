import { afterEach, describe, expect, test } from "bun:test";
import type { TestRendererSetup } from "@opentui/core/testing";
import { testRender } from "@opentui/solid";
import { createSignal, Show } from "solid-js";
import { processError } from "../../../../src/domain/shared/errors";
import type { WorkspaceId } from "../../../../src/domain/shared/ids";
import type { AbsolutePath } from "../../../../src/domain/shared/path";
import { err, ok } from "../../../../src/domain/shared/result";
import type { Timestamp } from "../../../../src/domain/shared/time";
import type { Workspace, WorkspaceName } from "../../../../src/domain/workspace/workspace";
import type { GitClient } from "../../../../src/plugins/git/application/git-client";
import type { GitStatus } from "../../../../src/plugins/git/domain/status";
import {
  branchBadge,
  fitRows,
  gitView,
  statusRows,
} from "../../../../src/plugins/git/tui/git-view";
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

async function render(client: GitClient, options: { workspace?: Workspace | null } = {}) {
  const statuses: (string | null)[] = [];
  const [shown, setShown] = createSignal(true);
  const View = gitView(client, 30);
  setup = await testRender(
    () => (
      <box width="100%" height="100%" flexDirection="column">
        <Show when={shown()}>
          <View
            workspace={options.workspace === undefined ? MOBILE : options.workspace}
            width={60}
            rows={12}
            icons="unicode"
            focused={false}
            setStatus={(status) => statuses.push(status)}
            setKeys={() => undefined}
            setModal={() => undefined}
            report={() => undefined}
          />
        </Show>
      </box>
    ),
    { width: 60, height: 14 },
  );
  await setup.renderOnce();
  return Object.assign(setup, { statuses, close: () => setShown(false) });
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
