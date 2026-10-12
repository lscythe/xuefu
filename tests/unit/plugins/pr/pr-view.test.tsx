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
import { prPlugin } from "../../../../src/plugins/pr/plugin";
import { prView } from "../../../../src/plugins/pr/tui/pr-view";
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
  } = {},
) {
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
          />
        </Show>
      </box>
    ),
    { width: 80, height: 34 },
  );
  await setup.renderOnce();
  return Object.assign(setup, {
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
  test("this branch's pull request, yours, and those to review, with the count to review", async () => {
    const view = await render(fakePullRequests({ yours: YOURS, toReview: TO_REVIEW }));
    const frame = await until(
      view,
      (f) => f.includes("To review (1)") && f.includes("This branch"),
    );
    const lines = frame.split("\n").map((line) => line.trimEnd());
    expect(lines.slice(0, 2)).toEqual([
      "This branch",
      "mobile-banking#42  0/1 approved  Add biometric login",
    ]);
    expect(frame).toContain("mobile-banking#40  needs work    Fix rotate crash");
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
    expect(view.keys.at(-1)).toBe(
      "enter details · a approve · n needs work · u withdraw · r refresh",
    );
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
