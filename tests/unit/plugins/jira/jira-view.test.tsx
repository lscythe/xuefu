import { afterEach, describe, expect, test } from "bun:test";
import { RGBA } from "@opentui/core";
import type { TestRendererSetup } from "@opentui/core/testing";
import { testRender } from "@opentui/solid";
import { createSignal, Show, Suspense } from "solid-js";
import { CommandBus } from "../../../../src/application/commands/command-bus";
import { configurationError, remoteError } from "../../../../src/domain/shared/errors";
import { err, ok } from "../../../../src/domain/shared/result";
import type { JiraClient } from "../../../../src/plugins/jira/application/jira-client";
import type { JiraIssue } from "../../../../src/plugins/jira/domain/issue";
import { jiraPlugin } from "../../../../src/plugins/jira/plugin";
import { jiraView } from "../../../../src/plugins/jira/tui/jira-view";
import type { PluginParts } from "../../../../src/plugins/plugin";
import { PALETTE } from "../../../../src/tui/theme/palette";
import { fakeJira, jiraIssue } from "../../../support/fake-jira";
import { fakeSecrets } from "../../../support/fake-secrets";
import { ManualClock } from "../../../support/manual-clock";
import { fakeCore } from "../../../support/plugin-context";
import { SequentialIds } from "../../../support/sequential-ids";
import { testLogger } from "../../../support/test-logger";

const ISSUES = [
  jiraIssue("MOB-2841", { summary: "Add biometric login" }),
  jiraIssue("MOB-2790", {
    summary: "Crash when rotating",
    status: { name: "To Do", category: "todo" },
  }),
  jiraIssue("MOB-2802", { summary: "Pending transactions" }),
];

type Found = Awaited<ReturnType<JiraClient["search"]>>;

/** A Jira whose list the test sets, one read at a time, remembering each read's signal. */
function changingJira(first: Found, overrides: Partial<JiraClient> = {}) {
  let answer = first;
  const signals: AbortSignal[] = [];
  const client = fakeJira(ISSUES, ISSUES.length, {
    search: (_jql, _max, signal) => {
      if (signal !== undefined) signals.push(signal);
      return Promise.resolve(answer);
    },
    ...overrides,
  });
  return {
    client,
    signals,
    answer: (next: Found) => {
      answer = next;
    },
  };
}

let setup: TestRendererSetup | undefined;
afterEach(() => {
  setup?.renderer.destroy();
  setup = undefined;
});

async function render(
  client: JiraClient,
  options: { focused?: boolean; rows?: number; refreshMs?: number } = {},
) {
  const statuses: (string | null)[] = [];
  const keys: (string | null)[] = [];
  const modal: boolean[] = [];
  const [shown, setShown] = createSignal(true);
  const View = jiraView({
    client,
    jql: "assignee = currentUser()",
    maxResults: 50,
    refreshMs: options.refreshMs ?? 60_000,
    timeZone: "UTC",
  });
  setup = await testRender(
    () => (
      <box width="100%" height="100%" flexDirection="column">
        <Show when={shown()}>
          <View
            workspace={null}
            width={60}
            rows={options.rows ?? 12}
            icons="unicode"
            focused={options.focused ?? false}
            setStatus={(status) => statuses.push(status)}
            setKeys={(next) => keys.push(next)}
            setModal={(open) => modal.push(open)}
            report={() => undefined}
          />
        </Show>
      </box>
    ),
    { width: 70, height: 30 },
  );
  await setup.renderOnce();
  return Object.assign(setup, { statuses, keys, modal, close: () => setShown(false) });
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

/** The text of the row showing `key`. */
const rowOf = (frame: string, key: string) =>
  frame.split("\n").find((line) => line.includes(key)) ?? "";

describe("jiraView", () => {
  test("lists the issues in columns, with the count in the frame", async () => {
    const view = await render(fakeJira(ISSUES, 7));
    const frame = await until(view, (f) => f.includes("MOB-2802"));
    expect(rowOf(frame, "MOB-2841")).toMatch(/^MOB-2841 {2}In Progress {2}Add biometric login/);
    expect(rowOf(frame, "MOB-2790")).toMatch(/^MOB-2790 {2}To Do {8}Crash when rotating/);
    expect(view.statuses.at(-1)).toBe("3 of 7");
    expect(view.keys.at(-1)).toBeNull();
  });

  test("before the first answer it says it is reading; with none, that nothing matches", async () => {
    const waiting = await render(
      fakeJira([], 0, { search: () => new Promise<Found>(() => undefined) }),
    );
    expect(waiting.captureCharFrame()).toContain("Reading your Jira issues...");
    waiting.renderer.destroy();
    const empty = await render(fakeJira([]));
    const frame = await until(empty, (f) => f.includes("No issues"));
    expect(frame).toContain("No issues match the query.");
    expect(frame).toContain("assignee = currentUser()");
    expect(empty.statuses.at(-1)).toBe("0 issues");
  });

  test("a first read that fails says why and what to do", async () => {
    const view = await render(
      fakeJira([], 0, {
        search: () =>
          Promise.resolve(
            err(
              remoteError("Jira did not accept the token", "jira.example.com", 401, {
                hint: "Make a personal access token in Jira.",
              }),
            ),
          ),
      }),
    );
    const frame = await until(view, (f) => f.includes("token"));
    expect(frame).toContain("✗ Jira did not accept the token");
    expect(frame).toContain("Make a personal access token in Jira.");
  });

  test("a failed refresh keeps the list, saying why above it, until a read succeeds", async () => {
    const jira = changingJira(ok({ issues: ISSUES, total: 3 }));
    const view = await render(jira.client, { focused: true });
    await until(view, (f) => f.includes("MOB-2802"));
    jira.answer(err(configurationError("Jira did not accept the query", "config.yml", [])));
    view.mockInput.pressKey("r");
    let frame = await until(view, (f) => f.includes("Could not refresh"));
    expect(frame).toContain("⚠ Could not refresh: Jira did not accept the query");
    expect(frame).toContain("MOB-2802");
    jira.answer(ok({ issues: ISSUES.slice(0, 1), total: 1 }));
    view.mockInput.pressKey("r");
    frame = await until(view, (f) => !f.includes("MOB-2802"));
    expect(frame).not.toContain("Could not refresh");
    expect(view.statuses.at(-1)).toBe("1 issue");
  });

  test("reads again every refreshMs, and stops reading once closed", async () => {
    const jira = changingJira(ok({ issues: ISSUES, total: 3 }));
    const view = await render(jira.client, { refreshMs: 20 });
    await until(view, () => jira.signals.length >= 3);
    view.close();
    const reads = jira.signals.length;
    await Bun.sleep(60);
    expect(jira.signals.length).toBe(reads);
  });

  test("with the keyboard, the arrows move the cursor, wrapping at the ends", async () => {
    const view = await render(fakeJira(ISSUES), { focused: true });
    await until(view, (f) => f.includes("MOB-2802"));
    expect(view.keys.at(-1)).toBe("enter details · r refresh");
    const chosen = () =>
      view
        .captureSpans()
        .lines.flatMap((line) => line.spans)
        .filter((span) => span.bg.equals(RGBA.fromHex(PALETTE.selectionBg)))
        .map((span) => span.text)
        .join("");
    await until(view, () => chosen().startsWith("MOB-2841"));
    view.mockInput.pressArrow("down");
    await until(view, () => chosen().startsWith("MOB-2790"));
    view.mockInput.pressArrow("up");
    view.mockInput.pressArrow("up");
    await until(view, () => chosen().startsWith("MOB-2802"));
    view.mockInput.pressKey("HOME");
    await until(view, () => chosen().startsWith("MOB-2841"));
    view.mockInput.pressKey("END");
    await until(view, () => chosen().startsWith("MOB-2802"));
  });
});

describe("the issue dialog", () => {
  const LONG: JiraIssue = jiraIssue("MOB-2841", {
    summary: "Add biometric login",
    priority: null,
    reporter: null,
    assignee: null,
    description: Array.from({ length: 30 }, (_, i) => `Line ${i + 1}`).join("\n"),
  });

  test("Enter shows the issue under the cursor; Esc closes it, handing keys back", async () => {
    const view = await render(fakeJira([LONG, ...ISSUES.slice(1)]), { focused: true });
    await until(view, (f) => f.includes("MOB-2802"));
    view.mockInput.pressEnter();
    const frame = await until(view, (f) => f.includes("Line 1"));
    expect(frame).toContain(" MOB-2841 ");
    expect(frame).toContain("Status    In Progress");
    expect(frame).toContain("Assignee  Unassigned");
    expect(frame).toContain("Updated   Tue 06 Oct 13:59");
    expect(frame).not.toContain("Priority");
    expect(frame).toContain("https://jira.example.com/browse/MOB-2841");
    expect(frame).toContain("↑↓ scroll  esc close  ");
    expect(view.modal).toEqual([true]);
    // The list under the dialog does not move while it is open.
    view.mockInput.pressArrow("down");
    await until(view, (f) => f.includes("Line 2") && !f.includes("Line 1\n"));
    view.mockInput.pressKey("END");
    await until(view, (f) => f.includes("Line 30") && f.includes("30/30"));
    view.mockInput.pressKey("HOME");
    await until(view, (f) => f.includes("Line 1 "));
    await pressEsc(view);
    await until(view, (f) => !f.includes("Line 1"));
    expect(view.modal).toEqual([true, false]);
    view.mockInput.pressArrow("down");
    view.mockInput.pressEnter();
    await until(view, (f) => f.includes("Crash when rotating") && f.includes("No description."));
    view.mockInput.pressKey("q");
    await until(view, (f) => !f.includes("No description."));
  });

  test("an issue that cannot be read says why", async () => {
    const view = await render(
      fakeJira(ISSUES, 3, {
        issue: () =>
          Promise.resolve(
            err(
              remoteError("Jira refused the request", "jira.example.com", 403, {
                hint: "The token's user may not be allowed to see this.",
              }),
            ),
          ),
      }),
      { focused: true },
    );
    await until(view, (f) => f.includes("MOB-2802"));
    view.mockInput.pressEnter();
    const frame = await until(view, (f) => f.includes("refused"));
    expect(frame).toContain("✗ Jira refused the request");
    expect(frame).toContain("The token's user may not be allowed to see this.");
    expect(frame).toContain("esc close");
  });

  test("closing the section closes the dialog and hands the keys back", async () => {
    const view = await render(fakeJira(ISSUES, 3, { issue: () => new Promise(() => undefined) }), {
      focused: true,
    });
    await until(view, (f) => f.includes("MOB-2802"));
    view.mockInput.pressEnter();
    await until(view, (f) => f.includes("Reading MOB-2841..."));
    view.close();
    await view.renderOnce();
    expect(view.modal).toEqual([true, false]);
  });
});

describe("the Jira plugin's section", () => {
  test("loads when first drawn and lists what Jira answers", async () => {
    const logger = testLogger().logger;
    const clock = new ManualClock();
    const started = jiraPlugin.start(
      {
        bus: new CommandBus({ logger, clock, ids: new SequentialIds() }),
        processes: { run: () => Promise.reject(new Error("jira runs no programs")) },
        http: {
          request: () =>
            Promise.resolve(
              ok({
                status: 200,
                headers: {},
                body: JSON.stringify({ issues: [], total: 0 }),
              }),
            ),
        },
        secrets: fakeSecrets({ JIRA_TOKEN: "pat" }),
        logger,
        clock,
        core: fakeCore().core,
      },
      { url: "https://jira.example.com", token: { env: "JIRA_TOKEN" } },
      "config.yml",
    );
    const View = (started.ok ? started.value : null)?.view as NonNullable<PluginParts["view"]>;
    setup = await testRender(
      () => (
        <box width="100%" height="100%" flexDirection="column">
          <Suspense>
            <View
              workspace={null}
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
      if (setup.captureCharFrame().includes("No issues")) break;
      await Bun.sleep(10);
    }
    expect(setup.captureCharFrame()).toContain("No issues match the query.");
  });
});
