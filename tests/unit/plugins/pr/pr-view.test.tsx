import { afterEach, describe, expect, test } from "bun:test";
import { RGBA } from "@opentui/core";
import type { TestRendererSetup } from "@opentui/core/testing";
import { testRender } from "@opentui/solid";
import { createSignal, Show, Suspense } from "solid-js";
import type { AppError } from "../../../../src/application/errors";
import { remoteError } from "../../../../src/domain/shared/errors";
import type { WorkspaceId } from "../../../../src/domain/shared/ids";
import type { AbsolutePath } from "../../../../src/domain/shared/path";
import { err, ok } from "../../../../src/domain/shared/result";
import type { Timestamp } from "../../../../src/domain/shared/time";
import type { Workspace, WorkspaceName } from "../../../../src/domain/workspace/workspace";
import type { PluginParts } from "../../../../src/plugins/plugin";
import type { Checkout } from "../../../../src/plugins/pr/application/checkout";
import type {
  PullRequestClient,
  PullRequestPage,
} from "../../../../src/plugins/pr/application/pull-request-client";
import type { CommentDraft, PullRequestComment } from "../../../../src/plugins/pr/domain/comment";
import { prPlugin } from "../../../../src/plugins/pr/plugin";
import { prView } from "../../../../src/plugins/pr/tui/pr-view";
import type { AgentQuestionAbout } from "../../../../src/tui/shell/section-props";
import { PALETTE } from "../../../../src/tui/theme/palette";
import { fakePullRequests, prChanges, pullRequest } from "../../../support/fake-pull-requests";
import { fakeSecrets } from "../../../support/fake-secrets";
import { pluginContext } from "../../../support/plugin-context";

const workspace = (id: string, name: string): Workspace => ({
  id: id as WorkspaceId,
  name: name as WorkspaceName,
  path: `/work/${id}` as AbsolutePath,
  group: null,
  addedAt: 0 as Timestamp,
  lastActiveAt: null,
});
const MOBILE = workspace("mobile", "Mobile");
const WALLET = workspace("wallet", "Wallet");

const ON_BRANCH: Checkout = {
  branch: "feature/change-42",
  origin: "https://bitbucket.example.com/scm/mob/mobile-banking.git",
};
const YOURS = [pullRequest(42, { title: "Add biometric login" }), pullRequest(37)];
const TO_REVIEW = [
  pullRequest(40, {
    title: "Fix rotate crash",
    reviewers: [{ name: "Dana Scully", status: "needs-work" }],
    description: Array.from({ length: 30 }, (_, i) => `Line ${i + 1}`).join("\n"),
  }),
];

let setup: TestRendererSetup | undefined;
afterEach(() => {
  setup?.renderer.destroy();
  setup = undefined;
});

async function render(
  client: PullRequestClient,
  options: {
    focused?: boolean;
    workspace?: Workspace | null;
    checkouts?: Record<string, Checkout | null>;
    refreshMs?: number;
    /** Gives the view an agent to ask, recording what it asks. */
    agent?: boolean;
  } = {},
) {
  const asked: AgentQuestionAbout[] = [];
  const statuses: (string | null)[] = [];
  const keys: (string | null)[] = [];
  const modal: boolean[] = [];
  const checkoutsRead: string[] = [];
  const [shown, setShown] = createSignal(true);
  const [front, setFront] = createSignal<Workspace | null>(
    options.workspace === undefined ? MOBILE : options.workspace,
  );
  const reported: AppError[] = [];
  const View = prView({
    ...prChanges(client, {
      read: (folder) => {
        checkoutsRead.push(folder);
        const by = options.checkouts?.[folder];
        return Promise.resolve(ok(by === undefined ? ON_BRANCH : by));
      },
    }),
    maxResults: 25,
    refreshMs: options.refreshMs ?? 60_000,
    timeZone: "UTC",
  });
  setup = await testRender(
    () => (
      <box width="100%" height="100%" flexDirection="column">
        <Show when={shown()}>
          <View
            workspace={front()}
            work={null}
            width={70}
            rows={16}
            icons="unicode"
            focused={options.focused ?? false}
            setStatus={(status) => statuses.push(status)}
            setKeys={(next) => keys.push(next)}
            setModal={(open) => modal.push(open)}
            report={(error) => reported.push(error)}
            askAgent={options.agent === true ? (question) => asked.push(question) : null}
          />
        </Show>
      </box>
    ),
    { width: 80, height: 34 },
  );
  await setup.renderOnce();
  return Object.assign(setup, {
    asked,
    statuses,
    keys,
    modal,
    checkoutsRead,
    reported,
    close: () => setShown(false),
    front: setFront,
  });
}

/** The frame once it satisfies `ready`, given real time for the client's promises. */
async function until(view: TestRendererSetup, ready: (frame: string) => boolean) {
  for (let tries = 0; tries < 100; tries++) {
    await view.renderOnce();
    const frame = view.captureCharFrame();
    if (ready(frame)) return frame;
    await Bun.sleep(5);
  }
  throw new Error(`Never drawn:\n${view.captureCharFrame()}`);
}

/** A lone ESC is only reported once the parser is sure no escape sequence follows. */
async function pressEsc(view: TestRendererSetup) {
  view.mockInput.pressEscape();
  await Bun.sleep(30);
}

const lit = (view: TestRendererSetup) =>
  view
    .captureSpans()
    .lines.flatMap((line) => line.spans)
    .filter((span) => span.bg.equals(RGBA.fromHex(PALETTE.selectionBg)))
    .map((span) => span.text)
    .join("");

describe("prView", () => {
  test("long authors fit the list and remain readable in details", async () => {
    const author = "Wahyu Dwi Hartarto With A Long Name";
    const pull = pullRequest(42, { author, title: "Fix cancellation" });
    const view = await render(fakePullRequests({ yours: [pull] }), { focused: true });
    const frame = await until(view, (f) => f.includes("Yours (1)"));
    expect(frame).toContain("Wahyu Dwi Hartar…");
    expect(frame).toContain("Fix cancellation");
    expect(frame).not.toContain(author);
    view.mockInput.pressEnter();
    const details = await until(view, (f) => f.includes("Author"));
    expect(details).toContain(author);
  });
  test("renders the details description as Markdown", async () => {
    const pull = pullRequest(42, {
      description:
        "# Description\n\n**Migration** to `PinActivity`.\n\n- Keep cancellation safe\n\n> Check the retry path\n\n```kotlin\nfinish()\n```",
    });
    const view = await render(fakePullRequests({ yours: [pull] }), { focused: true });
    await until(view, (f) => f.includes("Yours (1)"));
    view.mockInput.pressEnter();
    const frame = await until(view, (f) => f.includes("Description"));
    expect(frame).toContain("Migration to PinActivity.");
    expect(frame).not.toContain("# Description");
    expect(frame).not.toContain("**Migration**");
    expect(frame).not.toContain("```kotlin");
    expect(frame).toContain("• Keep cancellation safe");
    expect(frame).toContain("▎ Check the retry path");
  });
  test("this branch's pull request, yours, and those to review, with the count to review", async () => {
    const view = await render(fakePullRequests({ yours: YOURS, toReview: TO_REVIEW }));
    const frame = await until(
      view,
      (f) => f.includes("To review (1)") && f.includes("This branch"),
    );
    const lines = frame.split("\n").map((line) => line.trimEnd());
    expect(lines.slice(0, 2)).toEqual([
      "This branch",
      "mobile-banking#42  0/1 approved  Dana Scully  Add biometric login",
    ]);
    expect(frame).toContain("mobile-banking#40  needs work    Dana Scully  Fix rotate crash");
    expect(view.statuses.at(-1)).toBe("1 to review");
    expect(view.checkoutsRead).toEqual(["/work/mobile"]);
  });

  test("why this branch has none, and none open at all", async () => {
    const view = await render(fakePullRequests(), { checkouts: { "/work/mobile": null } });
    const frame = await until(view, (f) => f.includes("not a git repository"));
    expect(frame).toContain("Mobile is not a git repository.");
    expect(frame).toContain("No other open pull requests are yours or wait on your review.");
    expect(view.statuses.at(-1)).toBe("0 yours");
  });

  test("with no workspace open, only the lists are read", async () => {
    const view = await render(fakePullRequests({ yours: YOURS }), { workspace: null });
    const frame = await until(view, (f) => f.includes("Yours (2)"));
    expect(frame).toContain("No workspace is open.");
    expect(view.checkoutsRead).toEqual([]);
  });

  test("another workspace in front is read for its branch", async () => {
    const view = await render(fakePullRequests({ yours: YOURS }), {
      checkouts: { "/work/wallet": { branch: null, origin: ON_BRANCH.origin } },
    });
    await until(view, (f) => f.includes("Add biometric login") && f.includes("This branch"));
    view.front(WALLET);
    await until(view, (f) => f.includes("HEAD is detached in Wallet."));
    expect(view.checkoutsRead).toEqual(["/work/mobile", "/work/wallet"]);
  });

  test("a first read that fails says why; a failed refresh keeps the lists", async () => {
    let fail = true;
    const refused = remoteError(
      "Bitbucket did not accept the token",
      "bitbucket.example.com",
      401,
      {
        hint: "Make an HTTP access token.",
      },
    );
    const base = fakePullRequests({ yours: YOURS });
    const view = await render(
      {
        ...base,
        mine: (role, max) => (fail ? Promise.resolve(err(refused)) : base.mine(role, max)),
      },
      { focused: true },
    );
    let frame = await until(view, (f) => f.includes("token"));
    expect(frame).toContain("✗ Bitbucket did not accept the token");
    expect(frame).toContain("Make an HTTP access token.");
    fail = false;
    view.mockInput.pressKey("r");
    await until(view, (f) => f.includes("Yours (2)"));
    fail = true;
    view.mockInput.pressKey("r");
    frame = await until(view, (f) => f.includes("Could not refresh"));
    expect(frame).toContain("⚠ Could not refresh: Bitbucket did not accept the token");
    expect(frame).toContain("Yours (2)");
  });

  test("before anything is read it says so; it reads on a timer, and stops once closed", async () => {
    let reads = 0;
    const base = fakePullRequests();
    const waiting = await render({
      ...base,
      mine: () => new Promise<never>(() => undefined),
    });
    expect(waiting.captureCharFrame()).toContain("Reading your pull requests...");
    waiting.renderer.destroy();

    const view = await render(
      {
        ...base,
        mine: (role, max) => {
          reads += 1;
          return base.mine(role, max);
        },
      },
      { refreshMs: 20 },
    );
    await until(view, () => reads >= 6);
    view.close();
    const after = reads;
    await Bun.sleep(60);
    expect(reads).toBe(after);
  });

  test("the cursor moves over pull requests only; Enter shows one and Esc closes it", async () => {
    let builds = 0;
    const view = await render(
      fakePullRequests({ yours: YOURS, toReview: TO_REVIEW }, undefined, {
        builds: () => {
          builds += 1;
          return Promise.resolve(
            err(remoteError("Bitbucket answered 500", "bitbucket.example.com", 500)),
          );
        },
      }),
      { focused: true },
    );
    await until(view, (f) => f.includes("To review (1)") && f.includes("This branch"));
    // Too narrow for every key: the least used, r and u, are left out.
    expect(view.keys.at(-1)).toBe("enter details · d diff · a approve · n needs work · m merge");
    await until(view, () => lit(view).startsWith("mobile-banking#42"));
    view.mockInput.pressArrow("up");
    await until(view, () => lit(view).startsWith("mobile-banking#40"));
    view.mockInput.pressEnter();
    let frame = await until(view, (f) => f.includes("Line 1") && f.includes("could not be read"));
    expect(frame).toContain(" MOB/mobile-banking#40 ");
    expect(frame).toContain("Reviews    needs work");
    expect(frame).toContain("Dana Scully, needs work");
    expect(frame).toContain("Builds     could not be read: Bitbucket answered 500");
    expect(view.modal).toEqual([true]);
    view.mockInput.pressKey("END");
    frame = await until(view, (f) => f.includes("Line 30") && f.includes("30/30"));
    view.mockInput.pressArrow("up");
    await until(view, (f) => f.includes("29/30"));
    view.mockInput.pressKey("HOME");
    await until(view, (f) => f.includes("Line 1 "));
    await pressEsc(view);
    await until(view, (f) => !f.includes("Line 1"));
    expect(view.modal).toEqual([true, false]);
    expect(builds).toBe(1);
  });

  test("a pull request with builds and nothing to read shows them, and q closes it", async () => {
    const view = await render(
      fakePullRequests(
        {
          yours: [pullRequest(42, { reviewers: [], openTodos: 2, comments: 4, conflicted: true })],
        },
        { successful: 0, failed: 1, inProgress: 0 },
      ),
      { focused: true },
    );
    await until(view, (f) => f.includes("Yours (1)") && f.includes("This branch"));
    view.mockInput.pressEnter();
    const frame = await until(view, (f) => f.includes("1 failed"));
    expect(frame).toContain("Reviews    no reviewers");
    expect(frame).toContain("Comments   4, 2 to do");
    expect(frame).toContain("Merge      conflicts");
    expect(frame).toContain("No description.");
    view.mockInput.pressKey("q");
    await until(view, (f) => !f.includes("No description."));
  });

  test("A asks the agent to review the one under the cursor, from the list or its details", async () => {
    const sent: unknown[] = [];
    const view = await render(
      fakePullRequests({ yours: YOURS, toReview: TO_REVIEW }, undefined, {
        review: (...args) => {
          sent.push(args);
          return Promise.resolve(ok(undefined));
        },
      }),
      { focused: true, agent: true },
    );
    await until(view, (f) => f.includes("To review (1)") && f.includes("This branch"));
    view.mockInput.pressArrow("up");
    await until(view, () => lit(view).startsWith("mobile-banking#40"));
    view.mockInput.pressKey("A");
    await view.renderOnce();
    expect(view.asked).toHaveLength(1);
    expect(view.asked[0]?.title).toBe("Review MOB/mobile-banking#40");
    expect(view.asked[0]?.prompt).toContain('pullRequest "MOB/mobile-banking#40"');
    expect(view.asked[0]?.prompt).toContain("call post_comments once with the comments we settled");
    expect(view.asked[0]?.prompt).toContain("Do not post, approve or merge anything before I say");
    // Its branch is checked out while it is reviewed, and Claude is told so.
    expect(view.asked[0]?.branch).toBe("feature/change-40");
    expect(view.asked[0]?.prompt).toContain("XueFu checks out feature/change-40 here");
    // Asked in the workspace holding a clone of its repository, over SSH or HTTPS.
    const repository = view.asked[0]?.repository;
    expect(repository?.name).toBe("MOB/mobile-banking");
    expect(repository?.holds("ssh://git@bitbucket.example.com:7999/mob/mobile-banking.git")).toBe(
      true,
    );
    expect(repository?.holds("https://bitbucket.example.com/scm/MOB/Mobile-Banking.git")).toBe(
      true,
    );
    expect(repository?.holds("ssh://git@bitbucket.example.com:7999/mob/other.git")).toBe(false);
    expect(repository?.holds("ssh://git@bitbucket.example.com:7999/ops/mobile-banking.git")).toBe(
      false,
    );
    expect(repository?.holds("git@github.com:lscythe/xuefu.git")).toBe(false);
    // Shift+a is not a: nothing was approved.
    expect(sent).toEqual([]);

    view.mockInput.pressEnter();
    const details = await until(view, (f) => f.includes("A ask agent"));
    expect(details).toContain(" MOB/mobile-banking#40 ");
    view.mockInput.pressKey("A");
    await until(view, (f) => !f.includes("A ask agent"));
    expect(view.asked).toHaveLength(2);
    expect(view.modal.at(-1)).toBe(false);
  });

  test("without an agent, A does nothing and is not offered", async () => {
    const view = await render(fakePullRequests({ yours: YOURS }), { focused: true });
    await until(view, (f) => f.includes("Yours (2)"));
    expect(view.keys.at(-1)).not.toContain("ask agent");
    view.mockInput.pressKey("A");
    view.mockInput.pressEnter();
    const details = await until(view, (f) => f.includes("d diff"));
    expect(details).not.toContain("ask agent");
    view.mockInput.pressKey("A");
    await view.renderOnce();
    expect(view.captureCharFrame()).toContain("d diff");
    expect(view.asked).toEqual([]);
  });

  test("a approves the one under the cursor once confirmed, and says so", async () => {
    const sent: unknown[][] = [];
    const view = await render(
      fakePullRequests({ yours: YOURS, toReview: TO_REVIEW }, undefined, {
        review: (_repository, id, status, commit) => {
          sent.push([id, status, commit]);
          return Promise.resolve(ok(undefined));
        },
      }),
      { focused: true },
    );
    await until(view, (f) => f.includes("To review (1)") && f.includes("This branch"));
    view.mockInput.pressArrow("up");
    await until(view, () => lit(view).startsWith("mobile-banking#40"));
    view.mockInput.pressKey("a");
    const frame = await until(view, (f) => f.includes("Approve MOB/mobile-banking#40"));
    expect(frame).toContain("Approves it on Bitbucket, where its author and reviewers");
    expect(view.modal.at(-1)).toBe(true);
    view.mockInput.pressKey("y");
    await until(view, (f) => f.includes("✓ Approved mobile-banking#40."));
    expect(sent).toEqual([[40, "approved", "c0ffee40"]]);
    expect(view.modal.at(-1)).toBe(false);
  });

  test("n asks for changes and u withdraws; declined, nothing is sent; refused, it is reported", async () => {
    const sent: unknown[][] = [];
    const refused = remoteError("Bitbucket answered 409: changed", "bitbucket.example.com", 409);
    const view = await render(
      fakePullRequests({ yours: YOURS }, undefined, {
        review: (_repository, id, status) => {
          sent.push([id, status]);
          return Promise.resolve(status === "unapproved" ? err(refused) : ok(undefined));
        },
      }),
      { focused: true },
    );
    await until(view, (f) => f.includes("Yours (2)") && f.includes("This branch"));
    view.mockInput.pressKey("n");
    await until(view, (f) => f.includes("Ask for changes on MOB/mobile-banking#42"));
    view.mockInput.pressKey("n");
    await until(view, (f) => !f.includes("Ask for changes on"));
    expect(sent).toEqual([]);
    view.mockInput.pressKey("n");
    await until(view, (f) => f.includes("Ask for changes on MOB/mobile-banking#42"));
    view.mockInput.pressEnter();
    await until(view, (f) => f.includes("✓ Asked for changes on mobile-banking#42."));
    view.mockInput.pressKey("u");
    await until(view, (f) => f.includes("Withdraw your review of MOB/mobile-banking#42"));
    view.mockInput.pressKey("y");
    await until(view, () => view.reported.length > 0);
    expect(sent).toEqual([
      [42, "needs-work"],
      [42, "unapproved"],
    ]);
    expect(view.reported).toEqual([refused]);
  });

  test("m merges once Bitbucket says it can, asking first, of the version that was read", async () => {
    const merged: unknown[][] = [];
    const base = fakePullRequests({ yours: [pullRequest(42, { version: 7 })] });
    const view = await render(
      {
        ...base,
        merge: (repository, id, version) => {
          merged.push([id, version]);
          return base.merge(repository, id, version);
        },
      },
      { focused: true },
    );
    await until(view, (f) => f.includes("Yours (1)") && f.includes("This branch"));
    view.mockInput.pressKey("m");
    const frame = await until(view, (f) => f.includes("Merge MOB/mobile-banking#42"));
    expect(frame).toContain("feature/change-42 → main");
    expect(frame).toContain("Merges feature/change-42 into main on Bitbucket");
    view.mockInput.pressKey("y");
    await until(view, (f) => f.includes("✓ Merged mobile-banking#42 into main."));
    expect(merged).toEqual([[42, 7]]);
  });

  test("m on one that cannot be merged yet says why, and asks nothing", async () => {
    let merges = 0;
    const view = await render(
      fakePullRequests({ yours: YOURS }, undefined, {
        mergeability: () =>
          Promise.resolve(
            ok({ canMerge: false, conflicted: true, vetoes: ["Requires 2 approvals"] }),
          ),
        merge: () => {
          merges += 1;
          return new Promise(() => undefined);
        },
      }),
      { focused: true },
    );
    await until(view, (f) => f.includes("Yours (2)") && f.includes("This branch"));
    view.mockInput.pressKey("m");
    await until(view, (f) =>
      f.includes("⚠ MOB/mobile-banking#42 cannot be merged yet: it conflicts"),
    );
    expect(view.modal).toEqual([]);
    expect(merges).toBe(0);
  });

  /** A server whose comments are `threads`, to which a posted comment is added as a new thread. */
  const commenting = (threads: PullRequestComment[] = []) => {
    const posted: CommentDraft[] = [];
    const base = fakePullRequests({ yours: [pullRequest(42)] });
    const client: PullRequestClient = {
      ...base,
      comments: () => Promise.resolve(ok([...threads])),
      comment: async (repository, id, draft) => {
        posted.push(draft);
        const made = await base.comment(repository, id, draft);
        if (made.ok) threads.push({ ...made.value, id: 900 + posted.length });
        return made.ok ? ok({ ...made.value, id: 900 + posted.length }) : made;
      },
    };
    return { client, posted };
  };
  const thread = (id: number, extra: Partial<PullRequestComment> = {}): PullRequestComment => ({
    id,
    version: 0,
    author: "Fox Mulder",
    text: `Comment ${id}`,
    created: Date.UTC(2026, 9, 6, 9, 0),
    updated: Date.UTC(2026, 9, 6, 9, 0),
    anchor: null,
    todo: null,
    resolved: false,
    replies: [],
    ...extra,
  });

  test("d opens the diff with each thread under its line; q closes it", async () => {
    const { client } = commenting([
      thread(102, {
        text: "Fall back to the PIN?",
        anchor: {
          path: "app/src/Login.kt",
          line: 11,
          side: "new",
          lineKind: "added",
          outdated: false,
        },
        todo: "open",
        replies: [thread(105, { author: "Dana Scully", text: "It does." })],
      }),
    ]);
    const view = await render(client, { focused: true });
    await until(view, (f) => f.includes("Yours (1)") && f.includes("This branch"));
    view.mockInput.pressKey("d");
    const frame = await until(view, (f) => f.includes("Fall back to the PIN?"));
    const lines = frame.split("\n").map((line) => line.trim());
    const at = lines.findIndex((line) => line.includes("if (biometrics) prompt(42)"));
    expect(lines[at]).toContain("│        11 +         if (biometrics) prompt(42)");
    expect(lines[at + 1]).toContain("▍ Fox Mulder · Tue 06 Oct 09:00 · to do");
    expect(lines[at + 2]).toContain("Fall back to the PIN?");
    expect(lines[at + 3]).toContain("↳ Dana Scully · Tue 06 Oct 09:00");
    expect(frame).toContain("A docs/login.md  +2 -0");
    expect(view.modal.at(-1)).toBe(true);
    view.mockInput.pressKey("q");
    await until(view, (f) => !f.includes("Fall back to the PIN?"));
    expect(view.modal.at(-1)).toBe(false);
  });

  test("c comments on the line under the cursor, asking first, and it shows once posted", async () => {
    const { client, posted } = commenting();
    const view = await render(client, { focused: true });
    await until(view, (f) => f.includes("Yours (1)") && f.includes("This branch"));
    view.mockInput.pressEnter();
    await until(view, (f) => f.includes("d diff"));
    view.mockInput.pressKey("d");
    await until(view, (f) => f.includes("c comment"));
    // From the first line, past the removed one, to the first added.
    view.mockInput.pressArrow("down");
    view.mockInput.pressArrow("down");
    view.mockInput.pressKey("c");
    await until(view, (f) => f.includes("Comment on app/src/Login.kt, line 11"));
    await view.mockInput.typeText("Fall back to the PIN?");
    view.mockInput.pressKey("s", { ctrl: true });
    await until(view, (f) => f.includes("enter post"));
    view.mockInput.pressKey("y");
    await until(view, (f) => f.includes("✓ Posted #901 on app/src/Login.kt, line 11."));
    expect(posted).toEqual([
      {
        text: "Fall back to the PIN?",
        anchor: { path: "app/src/Login.kt", line: 11, side: "new", lineKind: "added" },
        replyTo: null,
      },
    ]);
  });

  test("on a comment, c replies to it; C comments on the whole; Esc keeps a draft", async () => {
    const { client, posted } = commenting([thread(101, { text: "Looks good." })]);
    const view = await render(client, { focused: true });
    await until(view, (f) => f.includes("Yours (1)") && f.includes("This branch"));
    view.mockInput.pressKey("d");
    await until(view, (f) => f.includes("c reply"));
    view.mockInput.pressKey("c");
    await until(view, (f) => f.includes("Comment on a reply to Fox Mulder"));
    await view.mockInput.typeText("Thanks");
    await pressEsc(view);
    await until(view, (f) => !f.includes("Comment on a reply"));
    view.mockInput.pressKey("c");
    const frame = await until(view, (f) => f.includes("Comment on a reply to Fox Mulder"));
    expect(frame).toContain("Thanks");
    view.mockInput.pressKey("s", { ctrl: true });
    await until(view, (f) => f.includes("enter post"));
    view.mockInput.pressKey("n");
    await until(view, (f) => !f.includes("enter post"));
    expect(posted).toEqual([]);
    view.mockInput.pressKey("s", { ctrl: true });
    await until(view, (f) => f.includes("enter post"));
    view.mockInput.pressEnter();
    await until(view, (f) => f.includes("✓ Posted"));
    // A fresh comment on the whole: the reply's draft went once it was posted.
    view.mockInput.pressKey("c", { shift: true });
    await until(view, (f) => f.includes("Comment on the pull request"));
    await view.mockInput.typeText("Ship it");
    view.mockInput.pressKey("s", { ctrl: true });
    await until(view, (f) => f.includes("enter post"));
    view.mockInput.pressKey("y");
    await until(view, () => posted.length === 2);
    expect(posted).toEqual([
      { text: "Thanks", anchor: null, replyTo: 101 },
      { text: "Ship it", anchor: null, replyTo: null },
    ]);
  });

  test("n and p go by file; Home, End and the page keys move far; r reads it again", async () => {
    let reads = 0;
    const base = fakePullRequests({ yours: [pullRequest(42)] });
    const view = await render(
      {
        ...base,
        comments: () => {
          reads += 1;
          return Promise.resolve(
            reads === 1
              ? ok([])
              : err(remoteError("Bitbucket answered 500", "bitbucket.example.com", 500)),
          );
        },
      },
      { focused: true },
    );
    await until(view, (f) => f.includes("Yours (1)") && f.includes("This branch"));
    view.mockInput.pressKey("d");
    await until(view, () => lit(view).includes("fun start()"));
    view.mockInput.pressKey("n");
    await until(view, () => lit(view).includes("# Login"));
    view.mockInput.pressKey("n");
    view.mockInput.pressKey("p");
    await until(view, () => lit(view).includes("fun start()"));
    view.mockInput.pressKey("END");
    await until(view, () => lit(view).includes("Face ID first"));
    view.mockInput.pressKey("HOME");
    await until(view, () => lit(view).includes("fun start()"));
    // The mock keyboard has no names for the page keys; these are what a terminal sends.
    view.mockInput.pressKey("\u001B[6~");
    await until(view, () => lit(view).includes("Face ID first"));
    view.mockInput.pressKey("\u001B[5~");
    await until(view, () => lit(view).includes("fun start()"));
    view.mockInput.pressKey("r");
    await until(view, (f) => f.includes("⚠ Could not read the comments: Bitbucket answered 500"));
    expect(reads).toBe(2);
  });

  test("a diff that cannot be read says why", async () => {
    const view = await render(
      fakePullRequests({ yours: [pullRequest(42)] }, undefined, {
        diff: () =>
          Promise.resolve(err(remoteError("Bitbucket answered 500", "bitbucket.example.com", 500))),
      }),
      { focused: true },
    );
    await until(view, (f) => f.includes("Yours (1)") && f.includes("This branch"));
    view.mockInput.pressKey("d");
    await until(view, (f) => f.includes("✗ Bitbucket answered 500"));
  });

  test("closing the section with the dialog open hands the keys back", async () => {
    const view = await render(
      fakePullRequests({ yours: YOURS }, undefined, {
        builds: () => new Promise(() => undefined),
      }),
      { focused: true },
    );
    await until(view, (f) => f.includes("Yours (2)") && f.includes("This branch"));
    view.mockInput.pressEnter();
    await until(view, (f) => f.includes("reading..."));
    view.close();
    await view.renderOnce();
    expect(view.modal).toEqual([true, false]);
  });
});

describe("the pull requests plugin's section", () => {
  test("loads when first drawn and lists what Bitbucket answers", async () => {
    const page: PullRequestPage = { pullRequests: [], more: false };
    const started = prPlugin.start(
      pluginContext({
        secrets: fakeSecrets({ BITBUCKET_TOKEN: "bbdc" }),
        http: {
          request: () =>
            Promise.resolve(
              ok({
                status: 200,
                headers: {},
                body: JSON.stringify({ values: page.pullRequests, isLastPage: true }),
              }),
            ),
        },
        processes: {
          run: () =>
            Promise.resolve(
              ok({ exitCode: 128, stdout: "", stderr: "", durationMs: 1, truncated: false }),
            ),
        },
      }),
      { url: "https://bitbucket.example.com", token: { env: "BITBUCKET_TOKEN" } },
      "config.yml",
    );
    const View = (started.ok ? started.value : null)?.view as NonNullable<PluginParts["view"]>;
    setup = await testRender(
      () => (
        <box width="100%" height="100%" flexDirection="column">
          <Suspense>
            <View
              workspace={MOBILE}
              work={null}
              width={60}
              rows={10}
              icons="unicode"
              focused={false}
              setStatus={() => undefined}
              setKeys={() => undefined}
              setModal={() => undefined}
              report={() => undefined}
            />
          </Suspense>
        </box>
      ),
      { width: 64, height: 24 },
    );
    for (let tries = 0; tries < 100; tries++) {
      await setup.renderOnce();
      if (setup.captureCharFrame().includes("not a git repository")) break;
      await Bun.sleep(10);
    }
    expect(setup.captureCharFrame()).toContain("Mobile is not a git repository.");
  });
});
