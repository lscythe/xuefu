import { afterEach, describe, expect, test } from "bun:test";
import { RGBA } from "@opentui/core";
import type { TestRendererSetup } from "@opentui/core/testing";
import { testRender } from "@opentui/solid";
import { storageError } from "../../../../src/domain/shared/errors";
import { err, ok } from "../../../../src/domain/shared/result";
import { Shell, type ShellProps } from "../../../../src/tui/shell/shell";
import { PALETTE } from "../../../../src/tui/theme/palette";
import { activityEntry, fakeActivity } from "../../../support/fake-activity";
import { fakeTabs } from "../../../support/fake-tabs";
import { fakeTimer } from "../../../support/fake-timer";
import { fakeWork } from "../../../support/fake-work";
import { ManualClock } from "../../../support/manual-clock";
import { workIn } from "../../../support/work";
import { view } from "../../../support/workspace-views";

const MOBILE = view("mobile-banking", "Mobile Banking", "Banking Client");
const VIEWS = [MOBILE, view("deployd", "deployd"), view("auth-service", "Auth Service")];

let setup: TestRendererSetup | undefined;
afterEach(() => {
  setup?.renderer.destroy();
  setup = undefined;
});

async function renderShell(
  props: Partial<ShellProps> = {},
  size = { width: 100, height: 30 },
): Promise<TestRendererSetup & { quits: () => number }> {
  let quits = 0;
  const tabs = fakeTabs(VIEWS, "mobile-banking");
  setup = await testRender(
    () => (
      <Shell
        clock={new ManualClock(Date.UTC(2026, 9, 6, 13, 59, 41))}
        timeZone="UTC"
        icons="unicode"
        tabs={tabs.initial}
        loadWorkspaces={() => Promise.resolve(ok(VIEWS))}
        activateWorkspace={tabs.activate}
        closeTab={tabs.close}
        navigation={new Map()}
        saveNavigation={() => Promise.resolve(ok(undefined))}
        timer={null}
        work={new Map()}
        startWork={() => Promise.resolve(err(storageError("not wired", "test")))}
        finishWork={() => Promise.resolve(err(storageError("not wired", "test")))}
        toggleTimer={() => Promise.resolve(ok(null))}
        stopTimer={() => Promise.resolve(ok(undefined))}
        loadActivity={() => ok([])}
        onRecorded={() => () => undefined}
        onQuit={() => {
          quits += 1;
        }}
        {...props}
      />
    ),
    size,
  );
  await setup.renderOnce();
  return Object.assign(setup, { quits: () => quits });
}

function rowContaining(frame: string, text: string): string {
  return frame.split("\n").find((line) => line.includes(text)) ?? "";
}

const header = (frame: string) => rowContaining(frame, "XUEFU");
const tabBar = (frame: string) => frame.split("\n")[1] ?? "";

describe("Shell tabs", () => {
  test("shows a numbered tab per open workspace under the header", async () => {
    const frame = (await renderShell()).captureCharFrame();
    expect(tabBar(frame)).toContain(" 1 Mobile Banking ");
    expect(rowContaining(frame, "navigate")).toContain("alt+1-9 tabs");
    expect(rowContaining(frame, "navigate")).toContain(": commands");
  });

  test("choosing in the switcher opens a tab; alt+digit brings tabs back to the front", async () => {
    const shell = await renderShell();
    shell.mockInput.pressKey("w", { ctrl: true });
    await shell.waitForFrame((f) => f.includes("Switch workspace"));
    await shell.mockInput.typeText("auth");
    shell.mockInput.pressEnter();
    const opened = await shell.waitForFrame((f) => header(f).includes("Auth Service"));
    expect(tabBar(opened)).toContain(" 1 Mobile Banking  2 Auth Service ");

    shell.mockInput.pressKey("1", { meta: true });
    await shell.waitForFrame((f) => header(f).includes("Mobile Banking"));
    shell.mockInput.pressKey("2", { meta: true });
    await shell.waitForFrame((f) => header(f).includes("Auth Service"));
    shell.mockInput.pressKey("7", { meta: true });
    await shell.renderOnce();
    expect(header(shell.captureCharFrame())).toContain("Auth Service");
  });

  test("each tab remembers its own section", async () => {
    const shell = await renderShell();
    shell.mockInput.pressKey("j");
    await shell.waitForFrame((f) => f.includes("▍WORK"));
    shell.mockInput.pressKey("w", { ctrl: true });
    await shell.waitForFrame((f) => f.includes("Switch workspace"));
    await shell.mockInput.typeText("dep");
    shell.mockInput.pressEnter();
    await shell.waitForFrame((f) => header(f).includes("deployd") && f.includes("▍DASHBOARD"));
    shell.mockInput.pressKey("1", { meta: true });
    await shell.waitForFrame((f) => header(f).includes("Mobile Banking") && f.includes("▍WORK"));
  });

  test("starts each workspace on its saved section and saves every change", async () => {
    const saved: string[] = [];
    const tabs = fakeTabs(VIEWS, "deployd", "mobile-banking");
    const shell = await renderShell({
      tabs: tabs.initial,
      activateWorkspace: tabs.activate,
      navigation: new Map([
        ["mobile-banking", "pulls"],
        ["deployd", "no-longer-a-section"],
      ]),
      saveNavigation: (workspace, section) => {
        saved.push(`${workspace.id}:${section}`);
        return Promise.resolve(ok(undefined));
      },
    });
    expect(shell.captureCharFrame()).toContain("▍PRS");
    shell.mockInput.pressKey("j");
    await shell.waitForFrame((f) => f.includes("▍TIMESHEET"));
    shell.mockInput.pressKey("1", { meta: true });
    await shell.waitForFrame((f) => header(f).includes("deployd") && f.includes("▍DASHBOARD"));
    expect(saved).toEqual(["mobile-banking:timesheet"]);
  });

  test("a section change that cannot be saved is reported", async () => {
    const shell = await renderShell({
      saveNavigation: () =>
        Promise.resolve(err(storageError("Unable to save the workspace session", "x"))),
    });
    shell.mockInput.pressKey("j");
    await shell.waitForFrame((f) => f.includes("✗ Unable to save the workspace session"));
  });

  test("outside every workspace the section is not saved", async () => {
    let saves = 0;
    const shell = await renderShell({
      tabs: fakeTabs(VIEWS).initial,
      saveNavigation: () => {
        saves += 1;
        return Promise.resolve(ok(undefined));
      },
    });
    shell.mockInput.pressKey("j");
    await shell.waitForFrame((f) => f.includes("▍WORK"));
    expect(saves).toBe(0);
  });

  test("alt+w closes the front tab; closing the last leaves no workspace", async () => {
    const tabs = fakeTabs(VIEWS, "mobile-banking", "deployd");
    const shell = await renderShell({
      tabs: tabs.initial,
      activateWorkspace: tabs.activate,
      closeTab: tabs.close,
    });
    expect(header(shell.captureCharFrame())).toContain("deployd");
    shell.mockInput.pressKey("w", { meta: true });
    const one = await shell.waitForFrame((f) => header(f).includes("Mobile Banking"));
    expect(tabBar(one)).not.toContain("deployd");
    shell.mockInput.pressKey("w", { meta: true });
    const none = await shell.waitForFrame((f) => header(f).includes("No workspace"));
    expect(none).not.toContain("1 Mobile Banking");
    expect(rowContaining(none, "navigate")).not.toContain("alt+1-9");
    shell.mockInput.pressKey("w", { meta: true });
    await shell.renderOnce();
  });

  test("a tab change that cannot be saved is reported and changes nothing", async () => {
    const failed = err(storageError("Unable to save open tabs", "workspace_tabs.save"));
    const tabs = fakeTabs(VIEWS, "mobile-banking", "deployd");
    const shell = await renderShell({
      tabs: tabs.initial,
      activateWorkspace: () => Promise.resolve(failed),
      closeTab: () => Promise.resolve(failed),
    });
    shell.mockInput.pressKey("1", { meta: true });
    const frame = await shell.waitForFrame((f) => f.includes("Unable to save open tabs"));
    expect(rowContaining(frame, "Unable to save")).toContain("✗ Unable to save open tabs");
    expect(header(frame)).toContain("deployd");
    shell.mockInput.pressKey("j");
    await shell.waitForFrame((f) => !f.includes("Unable to save open tabs"));
  });
});

describe("Shell timer", () => {
  const NOW = Date.UTC(2026, 9, 6, 13, 59, 41);
  const keyBar = (frame: string) => rowContaining(frame, "navigate");

  async function timerShell(props: Partial<ShellProps> = {}, size = { width: 100, height: 30 }) {
    const clock = new ManualClock(NOW);
    const timer = fakeTimer(
      clock,
      VIEWS.map((v) => v.workspace),
    );
    const shell = await renderShell(
      {
        clock,
        tickMs: 5,
        timer: timer.current(),
        toggleTimer: timer.toggle,
        stopTimer: timer.stop,
        ...props,
      },
      size,
    );
    return Object.assign(shell, { clock, timer });
  }

  test("t starts the front workspace's timer, which counts up in the header", async () => {
    const shell = await timerShell();
    expect(keyBar(shell.captureCharFrame())).toContain("t timer");
    expect(header(shell.captureCharFrame())).not.toContain("Timer");
    shell.mockInput.pressKey("t");
    await shell.waitForFrame((f) => header(f).includes("13:59 • Timer 00:00:00"));
    shell.clock.advance(6_138_000);
    await shell.waitForFrame((f) => header(f).includes("Timer 01:42:18"));
  });

  test("t pauses and resumes; shift+t stops", async () => {
    const shell = await timerShell();
    shell.mockInput.pressKey("t");
    await shell.waitForFrame((f) => header(f).includes("Timer 00:00:00"));
    shell.clock.advance(90_000);
    shell.mockInput.pressKey("t");
    await shell.waitForFrame((f) => header(f).includes("Paused 00:01:30"));
    shell.clock.advance(600_000);
    await Bun.sleep(25);
    expect(header(shell.captureCharFrame())).toContain("Paused 00:01:30");
    shell.mockInput.pressKey("t");
    await shell.waitForFrame((f) => header(f).includes("Timer 00:01:30"));
    await shell.mockInput.typeText("T");
    await shell.waitForFrame((f) => !header(f).includes("Timer"));
    expect(shell.timer.current()).toBeNull();
  });

  test("a timer running elsewhere shows whose it is; t here starts this one's own", async () => {
    const shell = await timerShell();
    shell.mockInput.pressKey("t");
    await shell.waitForFrame((f) => header(f).includes("Timer 00:00:00"));
    shell.mockInput.pressKey("w", { ctrl: true });
    await shell.waitForFrame((f) => f.includes("Switch workspace"));
    await shell.mockInput.typeText("auth");
    shell.mockInput.pressEnter();
    await shell.waitForFrame((f) => header(f).includes("Mobile Banking 00:00:00"));
    shell.mockInput.pressKey("t");
    await shell.waitForFrame((f) => header(f).includes("Timer 00:00:00"));
    expect<string | undefined>(shell.timer.current()?.workspace?.name).toBe("Auth Service");
  });

  test("the timer survives into the next session", async () => {
    const clock = new ManualClock(NOW - 60_000);
    const timer = fakeTimer(
      clock,
      VIEWS.map((v) => v.workspace),
    );
    await timer.toggle(MOBILE.workspace);
    clock.set(NOW);
    await timer.toggle(MOBILE.workspace);
    clock.advance(3_600_000);
    const frame = (await renderShell({ clock, timer: timer.current() })).captureCharFrame();
    expect(header(frame)).toContain("Paused 00:01:00");
  });

  test("with no workspace and no timer the key does nothing and is not offered", async () => {
    let toggles = 0;
    const shell = await timerShell({
      tabs: fakeTabs(VIEWS).initial,
      toggleTimer: () => {
        toggles += 1;
        return Promise.resolve(ok(null));
      },
    });
    expect(keyBar(shell.captureCharFrame())).not.toContain("t timer");
    shell.mockInput.pressKey("t");
    await shell.renderOnce();
    expect(toggles).toBe(1);
    expect(header(shell.captureCharFrame())).not.toContain("Timer");
  });

  test("failures are reported above the key bar", async () => {
    const shell = await timerShell({
      toggleTimer: () =>
        Promise.resolve(err(storageError("Unable to save the timer", "timers.save"))),
    });
    shell.mockInput.pressKey("t");
    await shell.waitForFrame((f) => f.includes("✗ Unable to save the timer"));
    await shell.mockInput.typeText("T");
    await shell.waitForFrame((f) => f.includes("✗ No timer is running"));
  });

  test("at 80 columns a long workspace name gives way to the clock and timer", async () => {
    const long = view("long", "Mobile Banking Platform Modernisation Programme");
    const tabs = fakeTabs([long], "long");
    const clock = new ManualClock(NOW);
    const timer = fakeTimer(clock, [long.workspace]);
    await timer.toggle(long.workspace);
    const frame = (
      await renderShell(
        { clock, tabs: tabs.initial, timer: timer.current() },
        { width: 80, height: 24 },
      )
    ).captureCharFrame();
    expect(header(frame)).toContain("Mobile Banking Platform M…  Tue");
    expect(header(frame)).toContain("Tue 06 Oct • 13:59 • Timer 00:00:00 ");
  });
});

describe("Shell work", () => {
  const NOW = Date.UTC(2026, 9, 6, 13, 59, 41);
  const WORK = workIn("mobile-banking", "MOB-2841", "Add biometric login", NOW - 3_600_000);
  const panel = (frame: string) => frame.split("\n").filter((line) => line.includes("│ "));

  async function openWork(props: Partial<ShellProps> = {}) {
    const shell = await renderShell({ work: WORK, ...props });
    shell.mockInput.pressKey("j");
    await shell.waitForFrame((f) => f.includes("▍WORK"));
    return shell;
  }

  test("the header names the work in progress after the workspace", async () => {
    const frame = (await renderShell({ work: WORK })).captureCharFrame();
    expect(header(frame)).toContain("Mobile Banking  │  MOB-2841 Add biometric login");
  });

  test("the Work section shows the issue, when it started and its timer", async () => {
    const shell = await openWork();
    const frame = shell.captureCharFrame();
    expect(frame).toContain("MOB-2841  Add biometric login");
    expect(frame).toContain("Started   Tue 06 Oct 12:59");
    expect(frame).toContain("Timer     not running, t starts it");
  });

  test("t times the work in progress, and the panel follows the timer", async () => {
    const clock = new ManualClock(NOW);
    const timer = fakeTimer(
      clock,
      VIEWS.map((v) => v.workspace),
    );
    const issues: (string | null)[] = [];
    const shell = await openWork({
      clock,
      tickMs: 5,
      toggleTimer: (front, issue) => {
        issues.push(issue);
        return timer.toggle(front, issue);
      },
    });
    shell.mockInput.pressKey("t");
    await shell.waitForFrame((f) => f.includes("Timer     00:00:00 running"));
    expect(issues).toEqual(["MOB-2841"]);
    expect<string | null | undefined>(timer.current()?.timer.issueKey).toBe("MOB-2841");
    clock.advance(90_000);
    shell.mockInput.pressKey("t");
    await shell.waitForFrame((f) => f.includes("Timer     00:01:30 paused"));
  });

  test("a timer for other work does not count as this work's", async () => {
    const clock = new ManualClock(NOW);
    const timer = fakeTimer(
      clock,
      VIEWS.map((v) => v.workspace),
    );
    await timer.toggle(MOBILE.workspace, null);
    const frame = (await openWork({ clock, timer: timer.current() })).captureCharFrame();
    expect(frame).toContain("Timer     not running, t starts it");
  });

  test("with nothing in progress, or no workspace, it says what to do", async () => {
    expect(panel((await openWork({ work: new Map() })).captureCharFrame()).join("\n")).toContain(
      "Nothing in progress in Mobile Banking.",
    );
    const none = await openWork({ tabs: fakeTabs(VIEWS).initial });
    expect(none.captureCharFrame()).toContain("Open a workspace with Ctrl+W to see its work.");
  });
});

describe("Shell activity", () => {
  const NOW = Date.UTC(2026, 9, 6, 13, 59, 41);
  const HOUR = 3_600_000;
  const mobile = MOBILE.workspace;
  const auth = VIEWS[2]?.workspace ?? null;
  const ENTRIES = [
    activityEntry(NOW - HOUR, mobile, "Started the timer for", { kind: "issue", text: "MOB-2841" }),
    activityEntry(NOW - 2 * HOUR, auth, "Opened"),
    activityEntry(NOW - 26 * HOUR, mobile, "Paused the timer", null, "01:42:18"),
  ];

  async function openActivity(activity = fakeActivity(ENTRIES), props: Partial<ShellProps> = {}) {
    const shell = await renderShell({
      navigation: new Map([["mobile-banking", "activity"]]),
      loadActivity: activity.load,
      onRecorded: activity.onRecorded,
      ...props,
    });
    await shell.waitForFrame((f) => f.includes("▍ACTIVITY"));
    return Object.assign(shell, { activity });
  }

  test("shows what happened in the workspace in front, newest first, by day", async () => {
    const shell = await openActivity();
    const frame = shell.captureCharFrame();
    expect(rowContaining(frame, "Today")).toContain("│ Today");
    expect(rowContaining(frame, "MOB-2841")).toContain("│ 12:59  Started the timer for MOB-2841");
    expect(rowContaining(frame, "Yesterday")).toContain("│ Yesterday");
    expect(rowContaining(frame, "Paused")).toContain("│ 11:59  Paused the timer  01:42:18");
    expect(frame).not.toContain("Opened");
    expect(shell.activity.loads).toEqual(["mobile-banking"]);
  });

  test("reads it again whenever something is recorded, and only while in front", async () => {
    const shell = await openActivity();
    shell.activity.record(activityEntry(NOW, mobile, "Finished work on"));
    await shell.waitForFrame((f) => f.includes("13:59  Finished work on"));
    shell.mockInput.pressKey("k");
    await shell.waitForFrame((f) => f.includes("▍JENKINS") || f.includes("▍ANDROID"));
    const loads = shell.activity.loads.length;
    shell.activity.record(activityEntry(NOW, mobile, "Opened"));
    await shell.renderOnce();
    expect(shell.activity.loads).toHaveLength(loads);
  });

  test("outside every workspace it shows them all, each named", async () => {
    const shell = await openActivity(fakeActivity(ENTRIES), {
      tabs: { open: [], active: null },
      navigation: new Map([["", "activity"]]),
    });
    const frame = shell.captureCharFrame();
    expect(rowContaining(frame, "Opened")).toContain("11:59  Auth Service    Opened");
    expect(rowContaining(frame, "MOB-2841")).toContain("12:59  Mobile Banking  Started");
    expect(shell.activity.loads).toEqual([null]);
  });

  test("says when nothing is recorded, and reports a failure to read", async () => {
    const empty = await openActivity(fakeActivity());
    expect(empty.captureCharFrame()).toContain("Nothing recorded in Mobile Banking yet.");
    empty.renderer.destroy();

    const failing = await openActivity(undefined, {
      loadActivity: () => err(storageError("Unable to read the activity ledger", "ledger.read")),
    });
    expect(failing.captureCharFrame()).toContain("✗ Unable to read the activity ledger");
  });

  test("fills the panel without spilling, cutting long lines at the edge", async () => {
    const many = Array.from({ length: 40 }, (_, i) =>
      activityEntry(NOW - i * 60_000, mobile, "Added", null, `/work/${"deep/".repeat(20)}folder`),
    );
    const shell = await openActivity(fakeActivity(many), {});
    const frame = shell.captureCharFrame();
    const shown = frame.split("\n").filter((line) => line.includes("Added"));
    expect(shown).toHaveLength(30 - 6 - 1);
    for (const line of shown) expect(line).toMatch(/deep… │$/);
    expect(rowContaining(frame, "navigate")).toContain("q quit");
  });

  test("stops listening when the cockpit closes", async () => {
    const shell = await openActivity();
    expect(shell.activity.listening()).toBe(1);
    shell.renderer.destroy();
    setup = undefined;
    expect(shell.activity.listening()).toBe(0);
  });
});

describe("Shell palette", () => {
  const NOW = Date.UTC(2026, 9, 6, 13, 59, 41);

  async function paletteShell(props: Partial<ShellProps> = {}) {
    const clock = new ManualClock(NOW);
    const timer = fakeTimer(
      clock,
      VIEWS.map((v) => v.workspace),
    );
    const work = fakeWork(clock, timer);
    const shell = await renderShell({
      clock,
      tickMs: 5,
      timer: timer.current(),
      toggleTimer: timer.toggle,
      stopTimer: timer.stop,
      startWork: work.start,
      finishWork: work.finish,
      ...props,
    });
    return Object.assign(shell, { clock, timer, work });
  }

  async function run(shell: TestRendererSetup, query: string) {
    await shell.mockInput.typeText(":");
    await shell.waitForFrame((f) => f.includes(" Commands "));
    await shell.mockInput.typeText(query);
    await shell.waitForFrame((f) => f.includes(`: ${query}`));
    shell.mockInput.pressEnter();
  }

  test(": lists what applies here, with each direct key", async () => {
    const shell = await paletteShell();
    expect(rowContaining(shell.captureCharFrame(), "navigate")).toContain(": commands");
    await shell.mockInput.typeText(":");
    const frame = await shell.waitForFrame((f) => f.includes(" Commands "));
    for (const title of ["Start work…", "Start timer", "Switch workspace", "Close tab", "Quit"]) {
      expect(frame).toContain(title);
    }
    expect(frame).not.toContain("Stop timer");
    expect(frame).not.toContain("Finish work");
  });

  test("start work from the palette: it shows in the header and is timed", async () => {
    const shell = await paletteShell();
    await run(shell, "start work");
    await shell.waitForFrame((f) => f.includes("Issue key"));
    await shell.mockInput.typeText("MOB-2841");
    shell.mockInput.pressEnter();
    await shell.waitForFrame((f) => f.includes("Title (optional)"));
    await shell.mockInput.typeText("Add biometric login");
    shell.mockInput.pressEnter();
    const frame = await shell.waitForFrame((f) => !f.includes(" Start work "));
    expect(header(frame)).toContain("MOB-2841 Add biometric log…");
    expect(header(frame)).toContain("Timer 00:00:00");
    expect<string | undefined>(shell.work.open().get("mobile-banking")?.issueKey).toBe("MOB-2841");
  });

  test("finish work from the palette clears it and stops its timer", async () => {
    const shell = await paletteShell();
    await shell.work.start(MOBILE.workspace, "MOB-1", null);
    shell.renderer.destroy();
    const again = await paletteShell({
      work: shell.work.open(),
      timer: shell.timer.current(),
      toggleTimer: shell.timer.toggle,
      stopTimer: shell.timer.stop,
      finishWork: shell.work.finish,
    });
    expect(header(again.captureCharFrame())).toContain("MOB-1");
    await run(again, "finish");
    const frame = await again.waitForFrame((f) => !f.includes(" Commands "));
    expect(header(frame)).not.toContain("MOB-1");
    expect(header(frame)).not.toContain("Timer");
  });

  test("timer entries follow the timer; their failures stay in the palette", async () => {
    const shell = await paletteShell({
      stopTimer: () =>
        Promise.resolve(err(storageError("Unable to save the timer", "timers.save"))),
    });
    await run(shell, "start timer");
    await shell.waitForFrame((f) => header(f).includes("Timer 00:00:00"));
    await run(shell, "stop timer");
    await shell.waitForFrame(
      (f) => f.includes("✗ Unable to save the timer") && f.includes(" Commands "),
    );
    shell.mockInput.pressEscape();
    await Bun.sleep(30);
    await shell.waitForFrame((f) => !f.includes(" Commands "));
    expect(header(shell.captureCharFrame())).toContain("Timer 00:00:00");
  });

  test("switch workspace and close tab work from the palette too", async () => {
    const shell = await paletteShell();
    await run(shell, "switch");
    await shell.waitForFrame((f) => f.includes("Switch workspace") && f.includes("of 3"));
    shell.mockInput.pressEscape();
    await Bun.sleep(30);
    await shell.waitForFrame((f) => !f.includes("Switch workspace"));
    await run(shell, "close tab");
    await shell.waitForFrame((f) => header(f).includes("No workspace"));
  });

  test("while the palette is open, keys go to it; quit runs from it", async () => {
    const shell = await paletteShell();
    await shell.mockInput.typeText(":");
    await shell.waitForFrame((f) => f.includes(" Commands "));
    await shell.mockInput.typeText("q");
    await shell.waitForFrame((f) => f.includes(": q"));
    expect(shell.quits()).toBe(0);
    shell.mockInput.pressEnter();
    await shell.waitForFrame(() => shell.quits() === 1);
  });

  test("a failure from a key is reported above the key bar", async () => {
    const shell = await paletteShell({
      closeTab: () =>
        Promise.resolve(err(storageError("Unable to save open tabs", "workspace_tabs.save"))),
    });
    shell.mockInput.pressKey("w", { meta: true });
    await shell.waitForFrame((f) => f.includes("✗ Unable to save open tabs"));
  });
});

describe("Shell", () => {
  test("shows the brand, workspace, clock, navigation, panel and key bar", async () => {
    const frame = (await renderShell()).captureCharFrame();
    const header = rowContaining(frame, "XUEFU");
    expect(header).toContain("血符 XUEFU");
    expect(header).toContain("Mobile Banking");
    expect(header).toContain("Tue 06 Oct • 13:59");
    for (const label of ["Dashboard", "Work", "Jira", "Git", "PRs", "Timesheet", "Notes"]) {
      expect(frame).toContain(label);
    }
    expect(frame).toContain("▍DASHBOARD");
    expect(rowContaining(frame, "navigate")).toContain("↑↓ navigate");
    expect(rowContaining(frame, "navigate")).toContain("^W workspaces");
    expect(rowContaining(frame, "navigate")).toContain("q quit");
  });

  test("says so when the current folder is not a workspace", async () => {
    const frame = (await renderShell({ tabs: fakeTabs(VIEWS).initial })).captureCharFrame();
    expect(rowContaining(frame, "XUEFU")).toContain("No workspace");
  });

  test("marks only the selected section", async () => {
    const frame = (await renderShell()).captureCharFrame();
    expect(rowContaining(frame, "Dashboard")).toContain("▌⌂ Dashboard");
    expect(rowContaining(frame, "Jira")).not.toContain("▌");
  });

  test("arrow keys and j/k move through sections and wrap at the ends", async () => {
    const shell = await renderShell();
    shell.mockInput.pressArrow("down");
    expect(await shell.waitForFrame((f) => f.includes("▍WORK"))).toContain("▌▤ Work");

    shell.mockInput.pressKey("k");
    await shell.waitForFrame((f) => f.includes("▍DASHBOARD"));

    shell.mockInput.pressArrow("up");
    expect(await shell.waitForFrame((f) => f.includes("▍NOTES"))).toContain("▌✎ Notes");

    shell.mockInput.pressKey("j");
    await shell.waitForFrame((f) => f.includes("▍DASHBOARD"));
  });

  test("home and end jump to the first and last section", async () => {
    const shell = await renderShell();
    shell.mockInput.pressKey("END");
    await shell.waitForFrame((f) => f.includes("▍NOTES"));
    shell.mockInput.pressKey("HOME");
    await shell.waitForFrame((f) => f.includes("▍DASHBOARD"));
  });

  test("q and ctrl+c ask to quit; other keys do not", async () => {
    const shell = await renderShell();
    shell.mockInput.pressKey("x");
    shell.mockInput.pressKey("q");
    shell.mockInput.pressCtrlC();
    await shell.renderOnce();
    expect(shell.quits()).toBe(2);
  });

  test("ctrl+w opens the switcher and choosing a workspace makes it current", async () => {
    const shell = await renderShell();
    shell.mockInput.pressKey("w", { ctrl: true });
    const open = await shell.waitForFrame((f) => f.includes("Switch workspace"));
    expect(rowContaining(open, "Mobile Banking  mobile-banking")).toContain("● current");

    await shell.mockInput.typeText("auth");
    shell.mockInput.pressEnter();
    const after = await shell.waitForFrame((f) => !f.includes("Switch workspace"));
    expect(rowContaining(after, "XUEFU")).toContain("Auth Service");

    shell.mockInput.pressKey("w", { ctrl: true });
    const reopened = await shell.waitForFrame((f) => f.includes("Switch workspace"));
    expect(rowContaining(reopened, "Auth Service  auth-service")).toContain("▸ Auth Service");
  });

  test("a switch that cannot be saved keeps the current workspace", async () => {
    const shell = await renderShell({
      activateWorkspace: () =>
        Promise.resolve(err(storageError("Unable to save workspaces", "workspaces.save"))),
    });
    shell.mockInput.pressKey("w", { ctrl: true });
    await shell.waitForFrame((f) => f.includes("Switch workspace"));
    await shell.mockInput.typeText("auth");
    shell.mockInput.pressEnter();
    const frame = await shell.waitForFrame((f) => f.includes("Unable to save workspaces"));
    expect(frame).toContain("Switch workspace");
    expect(rowContaining(frame, "XUEFU")).toContain("Mobile Banking");
  });

  test("while the switcher is open, letters go to the query, not the shell", async () => {
    const shell = await renderShell();
    shell.mockInput.pressKey("w", { ctrl: true });
    await shell.waitForFrame((f) => f.includes("Switch workspace"));
    await shell.mockInput.typeText("jq");
    const frame = await shell.waitForFrame((f) => f.includes("> jq"));
    expect(rowContaining(frame, "Dashboard")).toContain("▌⌂ Dashboard");
    expect(shell.quits()).toBe(0);

    shell.mockInput.pressEscape();
    await Bun.sleep(30);
    const closed = await shell.waitForFrame((f) => !f.includes("Switch workspace"));
    expect(rowContaining(closed, "XUEFU")).toContain("Mobile Banking");
    shell.mockInput.pressKey("j");
    await shell.waitForFrame((f) => f.includes("▍WORK"));
  });

  test("ctrl+c quits even with the switcher open", async () => {
    const shell = await renderShell();
    shell.mockInput.pressKey("w", { ctrl: true });
    await shell.waitForFrame((f) => f.includes("Switch workspace"));
    shell.mockInput.pressCtrlC();
    await shell.renderOnce();
    expect(shell.quits()).toBe(1);
  });

  test("the clock follows the injected time source", async () => {
    const clock = new ManualClock(Date.UTC(2026, 9, 6, 13, 59, 41));
    const shell = await renderShell({ clock, tickMs: 5 });
    clock.advance(60_000);
    await Bun.sleep(25);
    await shell.waitForFrame((f) => f.includes("Tue 06 Oct • 14:00"));
  });

  test("a terminal below 80×24 gets a notice instead of a broken layout", async () => {
    const shell = await renderShell({}, { width: 70, height: 20 });
    const frame = shell.captureCharFrame();
    expect(frame).toContain("Terminal too small");
    expect(frame).toContain("Need 80×24, have 70×20");
    expect(frame).not.toContain("Dashboard");

    shell.resize(80, 24);
    await shell.waitForFrame((f) => f.includes("Dashboard"));
  });

  test("ascii icons drop glyphs and arrows but keep every label", async () => {
    const frame = (await renderShell({ icons: "ascii" })).captureCharFrame();
    expect(rowContaining(frame, "Dashboard")).toContain("> Dashboard");
    expect(frame).not.toContain("⌂");
    expect(frame).not.toContain("▍");
    expect(frame).toContain("DASHBOARD");
    expect(rowContaining(frame, "navigate")).toContain("j/k navigate");
    expect(rowContaining(frame, "XUEFU")).toContain("Tue 06 Oct | 13:59");
  });

  test("uses the palette: vermilion brand mark and focus bar", async () => {
    const shell = await renderShell();
    const spans = shell.captureSpans().lines.flatMap((line) => line.spans);
    const brand = spans.find((span) => span.text.includes("血符"));
    const bar = spans.find((span) => span.text.startsWith("▌"));
    expect(brand?.fg.equals(RGBA.fromHex(PALETTE.accentPrimary))).toBe(true);
    expect(bar?.fg.equals(RGBA.fromHex(PALETTE.borderFocused))).toBe(true);
  });
});
