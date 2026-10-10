import { afterEach, describe, expect, test } from "bun:test";
import { RGBA } from "@opentui/core";
import type { TestRendererSetup } from "@opentui/core/testing";
import { testRender } from "@opentui/solid";
import { type Component, createEffect } from "solid-js";
import type { AppError } from "../../../../src/application/errors";
import type { SavedNote } from "../../../../src/application/notes/commands";
import type { Note, NoteBody } from "../../../../src/domain/notes/note";
import { storageError } from "../../../../src/domain/shared/errors";
import type { NoteId, WorkspaceId } from "../../../../src/domain/shared/ids";
import { err, ok, type Result } from "../../../../src/domain/shared/result";
import type { Timestamp } from "../../../../src/domain/shared/time";
import type { IssueKey } from "../../../../src/domain/work/issue-key";
import type { Workspace } from "../../../../src/domain/workspace/workspace";
import { bigClockRows } from "../../../../src/tui/big-clock";
import type { SectionProps } from "../../../../src/tui/shell/section-props";
import { cockpitSections } from "../../../../src/tui/shell/sections";
import { type CockpitSnapshot, Shell, type ShellProps } from "../../../../src/tui/shell/shell";
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
        sections={cockpitSections([])}
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
        reload={() => ok({ tabs: tabs.initial, timer: null, work: new Map() })}
        loadNote={() => ok(null)}
        noteText={() => ok("")}
        saveNote={() => Promise.resolve(err(storageError("not wired", "test")))}
        loadTracked={() => ok({ spans: [], workspaces: new Map() })}
        onExternalChange={() => () => undefined}
        onQuit={() => {
          quits += 1;
        }}
        {...props}
      />
    ),
    // As in main.ts: Ctrl+C reaches the cockpit, which decides what it means.
    { ...size, exitOnCtrlC: false },
  );
  await setup.renderOnce();
  return Object.assign(setup, { quits: () => quits });
}

function rowContaining(frame: string, text: string): string {
  return frame.split("\n").find((line) => line.includes(text)) ?? "";
}

const header = (frame: string) => rowContaining(frame, "血符");
const noteOn = (issue: string | null): Note => ({
  id: "n-1" as NoteId,
  workspaceId: "mobile-banking" as WorkspaceId,
  issueKey: issue as Note["issueKey"],
  body: "" as NoteBody,
  updatedAt: 0 as Timestamp,
});
/** The section in front, by the title in its frame; the dashboard by its first panel. */
const showing = (label: string) => (frame: string) =>
  frame.includes(label === "Dashboard" ? "─ 1 Work ─" : `─ ${label} ─`);

describe("Shell tabs", () => {
  test("shows a numbered tab per open workspace in the header, underlining the front one", async () => {
    const frame = (await renderShell()).captureCharFrame();
    expect(frame.split("\n")[1]).toBe(`       ${"▔".repeat(18)}`.padEnd(100));
    expect(header(frame)).toContain(" 1 Mobile Banking ");
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
    expect(header(opened)).toContain(" 1 Mobile Banking  2 Auth Service ");
    expect(opened.split("\n")[1]).toContain(`${" ".repeat(25)}${"▔".repeat(16)}`);

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
    await shell.waitForFrame((f) => showing("Work")(f));
    shell.mockInput.pressKey("w", { ctrl: true });
    await shell.waitForFrame((f) => f.includes("Switch workspace"));
    await shell.mockInput.typeText("dep");
    shell.mockInput.pressEnter();
    await shell.waitForFrame((f) => header(f).includes("deployd") && showing("Dashboard")(f));
    shell.mockInput.pressKey("1", { meta: true });
    await shell.waitForFrame((f) => header(f).includes("Mobile Banking") && showing("Work")(f));
  });

  test("starts each workspace on its saved section and saves every change", async () => {
    const saved: string[] = [];
    const tabs = fakeTabs(VIEWS, "deployd", "mobile-banking");
    const shell = await renderShell({
      tabs: tabs.initial,
      activateWorkspace: tabs.activate,
      navigation: new Map([
        ["mobile-banking", "activity"],
        ["deployd", "no-longer-a-section"],
      ]),
      saveNavigation: (workspace, section) => {
        saved.push(`${workspace.id}:${section}`);
        return Promise.resolve(ok(undefined));
      },
    });
    expect(shell.captureCharFrame()).toContain("─ Activity ─");
    shell.mockInput.pressKey("j");
    await shell.waitForFrame((f) => showing("Notes")(f));
    shell.mockInput.pressKey("1", { meta: true });
    await shell.waitForFrame((f) => header(f).includes("deployd") && showing("Dashboard")(f));
    expect(saved).toEqual(["mobile-banking:notes"]);
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
    await shell.waitForFrame((f) => showing("Work")(f));
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
    expect(header(one)).not.toContain("deployd");
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
    expect(header(shell.captureCharFrame())).not.toContain("●");
    shell.mockInput.pressKey("t");
    await shell.waitForFrame((f) => header(f).includes("● 00:00:00  │  Tue 06 Oct  13:59"));
    shell.clock.advance(6_138_000);
    await shell.waitForFrame((f) => header(f).includes("● 01:42:18"));
  });

  test("t pauses and resumes; shift+t stops", async () => {
    const shell = await timerShell();
    shell.mockInput.pressKey("t");
    await shell.waitForFrame((f) => header(f).includes("● 00:00:00"));
    shell.clock.advance(90_000);
    shell.mockInput.pressKey("t");
    await shell.waitForFrame((f) => header(f).includes("● 00:01:30 paused"));
    shell.clock.advance(600_000);
    await Bun.sleep(25);
    expect(header(shell.captureCharFrame())).toContain("● 00:01:30 paused");
    shell.mockInput.pressKey("t");
    await shell.waitForFrame((f) => header(f).includes("● 00:01:30  │"));
    await shell.mockInput.typeText("T");
    await shell.waitForFrame((f) => !header(f).includes("●"));
    expect(shell.timer.current()).toBeNull();
  });

  test("a timer running elsewhere shows whose it is; t here starts this one's own", async () => {
    const shell = await timerShell();
    shell.mockInput.pressKey("t");
    await shell.waitForFrame((f) => header(f).includes("● 00:00:00"));
    shell.mockInput.pressKey("w", { ctrl: true });
    await shell.waitForFrame((f) => f.includes("Switch workspace"));
    await shell.mockInput.typeText("auth");
    shell.mockInput.pressEnter();
    await shell.waitForFrame((f) => header(f).includes("Mobile Banking ● 00:00:00"));
    shell.mockInput.pressKey("t");
    await shell.waitForFrame((f) => header(f).includes("  ● 00:00:00"));
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
    expect(header(frame)).toContain("● 00:01:00 paused");
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
    expect(header(shell.captureCharFrame())).not.toContain("●");
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

  test("at 80 columns a long workspace name gives way to the timer and time", async () => {
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
    expect(header(frame)).toContain(" 1 Mobile Banking Platform Modernisation Program… ");
    expect(header(frame)).toMatch(/ {2}● 00:00:00 {2}│ {2}13:59 $/);
  });
});

describe("Shell work", () => {
  const NOW = Date.UTC(2026, 9, 6, 13, 59, 41);
  const WORK = workIn("mobile-banking", "MOB-2841", "Add biometric login", NOW - 3_600_000);
  const panel = (frame: string) => frame.split("\n").filter((line) => line.includes("│ "));

  async function openWork(props: Partial<ShellProps> = {}) {
    const shell = await renderShell({ work: WORK, ...props });
    shell.mockInput.pressKey("j");
    await shell.waitForFrame((f) => showing("Work")(f));
    return shell;
  }

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
    const running = await shell.waitForFrame((f) =>
      f.includes("Started Tue 06 Oct 12:59 · running"),
    );
    for (const row of bigClockRows("00:00:00", "large")) expect(running).toContain(row);
    expect(running).toContain("─ running ─");
    expect(running).toContain(" t pause · T stop ");
    expect(issues).toEqual(["MOB-2841"]);
    expect<string | null | undefined>(timer.current()?.timer.issueKey).toBe("MOB-2841");
    clock.advance(90_000);
    shell.mockInput.pressKey("t");
    const paused = await shell.waitForFrame((f) => f.includes("Started Tue 06 Oct 12:59 · paused"));
    for (const row of bigClockRows("00:01:30", "large")) expect(paused).toContain(row);
    expect(paused).toContain(" t resume · T stop ");
  });

  test("in ascii the time is written plainly rather than drawn in blocks", async () => {
    const clock = new ManualClock(NOW);
    const timer = fakeTimer(
      clock,
      VIEWS.map((v) => v.workspace),
    );
    await timer.toggle(MOBILE.workspace, "MOB-2841" as IssueKey);
    const frame = (
      await openWork({ clock, timer: timer.current(), icons: "ascii" })
    ).captureCharFrame();
    expect(frame).toContain("Timer     00:00:00 running");
    expect(frame).not.toContain("█");
    expect(frame).toContain(" t pause | T stop ");
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
    await shell.waitForFrame((f) => showing("Activity")(f));
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
    await shell.waitForFrame((f) => showing("Timesheet")(f));
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
    expect(shown).toHaveLength(30 - 5 - 1);
    for (const line of shown) expect(line).toMatch(/dee… │$/);
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

describe("Shell notes", () => {
  const NOW = Date.UTC(2026, 9, 6, 13, 59, 41);
  const WORK = workIn("mobile-banking", "MOB-2841", "Add biometric login", NOW - 3_600_000);
  const note = (issue: string | null, body: string): Note => ({
    id: `n-${issue ?? "own"}` as NoteId,
    workspaceId: "mobile-banking" as WorkspaceId,
    issueKey: issue as Note["issueKey"],
    body: body as NoteBody,
    updatedAt: NOW as Timestamp,
  });

  /** Notes keyed by "workspace:issue"; `record()` stands in for a save the cockpit hears about. */
  function storedNotes(...notes: Note[]) {
    const all = new Map(notes.map((n) => [`${n.workspaceId}:${n.issueKey ?? ""}`, n]));
    const listeners = new Set<() => void>();
    return {
      loadNote: (workspace: { id: string }, issue: string | null) =>
        ok(all.get(`${workspace.id}:${issue ?? ""}`) ?? null),
      onRecorded: (listener: () => void) => {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
      record: (changed: Note) => {
        all.set(`${changed.workspaceId}:${changed.issueKey ?? ""}`, changed);
        for (const listener of listeners) listener();
      },
    };
  }

  async function openNotes(props: Partial<ShellProps> = {}) {
    const shell = await renderShell({
      navigation: new Map([
        ["mobile-banking", "notes"],
        ["", "notes"],
      ]),
      ...props,
    });
    await shell.waitForFrame((f) => showing("Notes")(f));
    return shell;
  }

  test("shows the workspace's note and the note on the work in progress", async () => {
    const notes = storedNotes(
      note(null, "Staging needs the VPN\nAsk Dana for access"),
      note("MOB-2841", "Ask QA about the flaky test"),
    );
    const frame = (await openNotes({ work: WORK, ...notes })).captureCharFrame();
    expect(rowContaining(frame, "Staging")).toContain("│ Staging needs the VPN");
    expect(rowContaining(frame, "Dana")).toContain("│ Ask Dana for access");
    expect(rowContaining(frame, "MOB-2841  Add")).toContain("│ MOB-2841  Add biometric login");
    expect(rowContaining(frame, "flaky")).toContain("│ Ask QA about the flaky test");
  });

  test("says which key writes a note where there is none, and sets the keys in the frame", async () => {
    const frame = (await openNotes({ work: WORK })).captureCharFrame();
    expect(rowContaining(frame, "No note yet")).toContain("│ No note yet. Press e to write one.");
    expect(frame).toContain("No note on MOB-2841 yet. Press i to write one.");
    expect(frame).toContain(" e edit · i edit MOB-2841 ");
  });

  test("without work in progress only the workspace's own note is shown", async () => {
    const frame = (await openNotes(storedNotes(note(null, "Own note")))).captureCharFrame();
    expect(frame).toContain("Own note");
    expect(frame).not.toContain("MOB-");
  });

  test("reads the notes again when one is saved", async () => {
    const notes = storedNotes(note(null, "before"));
    const shell = await openNotes(notes);
    notes.record(note(null, "after the save"));
    await shell.waitForFrame((f) => f.includes("after the save"));
  });

  test("outside every workspace it says how to open one; a failed read is reported", async () => {
    const outside = await openNotes({ tabs: { open: [], active: null } });
    expect(outside.captureCharFrame()).toContain("Open a workspace with Ctrl+W to see its notes.");
    outside.renderer.destroy();

    const failing = await openNotes({
      loadNote: () => err(storageError("Unable to read notes", "notes.read")),
    });
    expect(failing.captureCharFrame()).toContain("✗ Unable to read notes");
  });
});

describe("Shell note editor", () => {
  const NOW = Date.UTC(2026, 9, 6, 13, 59, 41);
  const WORK = workIn("mobile-banking", "MOB-2841", "Add biometric login", NOW - 3_600_000);
  const SAVED: SavedNote = {
    note: null,
    changed: true,
    secret: false,
    workspace: VIEWS[0]?.workspace as Workspace,
  };

  /** The cockpit on its Notes section, recording every save. */
  async function notes(
    props: Partial<ShellProps> = {},
    saved: Result<SavedNote, AppError> = ok(SAVED),
  ) {
    const saves: { workspace: string; issue: string | null; text: string }[] = [];
    const shell = await renderShell({
      navigation: new Map([["mobile-banking", "notes"]]),
      noteText: () => ok("Staging needs the VPN"),
      saveNote: (workspace, issue, text) => {
        saves.push({ workspace: workspace.id, issue, text });
        return Promise.resolve(saved);
      },
      ...props,
    });
    await shell.waitForFrame((f) => showing("Notes")(f));
    return Object.assign(shell, { saves });
  }

  const editorOpen = (f: string) => f.includes("ctrl+s save  esc cancel");
  /** A lone ESC is only reported once the parser is sure no escape sequence follows. */
  const pressEsc = async (shell: TestRendererSetup) => {
    shell.mockInput.pressEscape();
    await Bun.sleep(30);
  };

  test("e opens the workspace's note as stored; ctrl+s saves it and closes", async () => {
    const shell = await notes();
    shell.mockInput.pressKey("e");
    await shell.waitForFrame((f) => f.includes(" Note on Mobile Banking ") && editorOpen(f));
    expect(shell.captureCharFrame()).toContain("Staging needs the VPN");

    shell.mockInput.pressKey("END");
    await shell.mockInput.typeText("; ask Dana");
    shell.mockInput.pressKey("s", { ctrl: true });
    await shell.waitForFrame((f) => !f.includes(" Note on "));
    expect(shell.saves).toEqual([
      { workspace: "mobile-banking", issue: null, text: "Staging needs the VPN; ask Dana" },
    ]);
  });

  test("i opens the note on the work in progress, and does nothing without any", async () => {
    const idle = await notes();
    idle.mockInput.pressKey("i");
    await idle.renderOnce();
    expect(idle.captureCharFrame()).not.toContain(" Note on ");
    idle.renderer.destroy();

    const shell = await notes({ work: WORK, noteText: (_, issue) => ok(`on ${issue}`) });
    shell.mockInput.pressKey("i");
    await shell.waitForFrame((f) => f.includes(" Note on MOB-2841 ") && f.includes("on MOB-2841"));
  });

  test("keys typed into the editor stay there: q, t and digits do not reach the cockpit", async () => {
    const shell = await notes({ noteText: () => ok("") });
    shell.mockInput.pressKey("e");
    await shell.waitForFrame(editorOpen);
    await shell.mockInput.typeText("qt1");
    shell.mockInput.pressKey("s", { ctrl: true });
    await shell.waitForFrame((f) => !f.includes(" Note on "));
    expect(shell.quits()).toBe(0);
    expect(shell.saves.map((saved) => saved.text)).toEqual(["qt1"]);
  });

  test("esc closes at once when nothing changed", async () => {
    const shell = await notes();
    shell.mockInput.pressKey("e");
    await shell.waitForFrame(editorOpen);
    await pressEsc(shell);
    await shell.waitForFrame((f) => !f.includes(" Note on "));
    expect(shell.saves).toEqual([]);
  });

  test("with unsaved text, esc and ctrl+c ask first; a second press discards", async () => {
    const shell = await notes();
    shell.mockInput.pressKey("e");
    await shell.waitForFrame(editorOpen);
    await shell.mockInput.typeText("draft");

    shell.mockInput.pressCtrlC();
    await shell.waitForFrame((f) => f.includes("Unsaved changes: esc again discards them"));
    expect(shell.quits()).toBe(0);

    await shell.mockInput.typeText("!");
    await shell.waitForFrame(editorOpen);
    await pressEsc(shell);
    await shell.waitForFrame((f) => f.includes("Unsaved changes"));
    await pressEsc(shell);
    await shell.waitForFrame((f) => !f.includes(" Note on "));
    expect(shell.saves).toEqual([]);
    expect(shell.quits()).toBe(0);
  });

  test("emptying the text offers to clear the note", async () => {
    const shell = await notes({ noteText: () => ok("x") });
    shell.mockInput.pressKey("e");
    await shell.waitForFrame(editorOpen);
    shell.mockInput.pressKey("END");
    shell.mockInput.pressBackspace();
    await shell.waitForFrame((f) => f.includes("ctrl+s clear note  esc cancel"));
  });

  test("a failed save keeps the editor open with the error", async () => {
    const failed = err(storageError("Unable to save the note", "notes.save"));
    const shell = await notes({}, failed);
    shell.mockInput.pressKey("e");
    await shell.waitForFrame(editorOpen);
    await shell.mockInput.typeText("more");
    shell.mockInput.pressKey("s", { ctrl: true });
    await shell.waitForFrame((f) => f.includes("✗ Unable to save the note") && editorOpen(f));
  });

  test("text that looks like a secret is saved, then the editor says so until esc", async () => {
    const shell = await notes({}, ok({ ...SAVED, secret: true }));
    shell.mockInput.pressKey("e");
    await shell.waitForFrame(editorOpen);
    await shell.mockInput.typeText(" token=abc");
    shell.mockInput.pressKey("s", { ctrl: true });
    await shell.waitForFrame((f) => f.includes("looks like it holds a secret"));
    expect(shell.saves).toHaveLength(1);
    await pressEsc(shell);
    await shell.waitForFrame((f) => !f.includes(" Note on "));
  });

  test("a note that cannot be read is reported instead of opening an empty editor", async () => {
    const shell = await notes({
      noteText: () => err(storageError("Unable to read notes", "notes.read")),
    });
    shell.mockInput.pressKey("e");
    await shell.waitForFrame((f) => f.includes("✗ Unable to read notes"));
    expect(shell.captureCharFrame()).not.toContain(" Note on ");
  });

  test("on the dashboard, e edits only once the Notes panel has focus", async () => {
    const shell = await renderShell({ noteText: () => ok("") });
    shell.mockInput.pressKey("e");
    await shell.renderOnce();
    expect(shell.captureCharFrame()).not.toContain(" Note on ");

    shell.mockInput.pressKey("3");
    await shell.waitForFrame((f) => f.includes(" e edit · ⏎ open "));
    shell.mockInput.pressKey("e");
    await shell.waitForFrame(editorOpen);
  });

  test("the palette opens the editor too", async () => {
    const own = await notes();
    own.mockInput.pressKey(":");
    await own.waitForFrame((f) => f.includes("Edit note on Mobile Banking"));
    await own.mockInput.typeText("edit note");
    own.mockInput.pressEnter();
    await own.waitForFrame((f) => f.includes(" Note on Mobile Banking ") && editorOpen(f));
    own.renderer.destroy();

    const shell = await notes({ work: WORK });
    shell.mockInput.pressKey(":");
    await shell.waitForFrame((f) => f.includes("Edit note on MOB-2841"));
    await shell.mockInput.typeText("edit note on mob-");
    shell.mockInput.pressEnter();
    await shell.waitForFrame((f) => f.includes(" Note on MOB-2841 ") && editorOpen(f));
  });
});

describe("Shell plugin sections", () => {
  /** A plugin's view that shows what it was given and sets a status for the frame. */
  const view: Component<SectionProps> = (props) => {
    createEffect(() => props.setStatus(`on ${props.workspace?.id ?? "nothing"}`));
    return <text>{`${props.workspace?.name ?? "none"} in ${props.width}x${props.rows}`}</text>;
  };
  const GIT = { id: "git", label: "Git", icons: { nerd: "\u{e725}", letter: "G" }, view };

  test("a plugin's section sits after Work, drawn by its view with a status in the frame", async () => {
    const shell = await renderShell({
      sections: cockpitSections([GIT]),
      navigation: new Map([["mobile-banking", "git"]]),
    });
    const frame = await shell.waitForFrame(
      (f) => showing("Git")(f) && f.includes(" on mobile-banking "),
    );
    expect(frame).toContain("│ Mobile Banking in 79x25");
    expect(frame).toContain("│  G  Git ");
    expect(frame.indexOf("  Git ")).toBeLessThan(frame.indexOf("  Timesheet"));

    shell.mockInput.pressKey("j");
    const next = await shell.waitForFrame((f) => showing("Timesheet")(f));
    expect(next).not.toContain(" on mobile-banking ");
  });

  test("its view follows the workspace in front", async () => {
    const tabs = fakeTabs(VIEWS, "mobile-banking", "deployd");
    const shell = await renderShell({
      sections: cockpitSections([GIT]),
      tabs: tabs.initial,
      activateWorkspace: tabs.activate,
      navigation: new Map([
        ["mobile-banking", "git"],
        ["deployd", "git"],
      ]),
    });
    await shell.waitForFrame((f) => f.includes(" on deployd "));
    shell.mockInput.pressKey("1", { meta: true });
    await shell.waitForFrame(
      (f) => f.includes("│ Mobile Banking in") && f.includes(" on mobile-banking "),
    );
  });
});

describe("Shell dashboard", () => {
  const NOW = Date.UTC(2026, 9, 6, 13, 59, 41);
  const WORK = workIn("mobile-banking", "MOB-2841", "Add biometric login", NOW - 3_600_000);
  const peach = RGBA.fromHex(PALETTE.borderFocused);

  /** Whether the panel with this title is the one lit. */
  const lit = (shell: TestRendererSetup, title: string) =>
    shell
      .captureSpans()
      .lines.flatMap((line) => line.spans)
      .some((span) => span.fg.equals(peach) && span.text.includes(` ${title} `));

  test("shows Work, Today, Notes and Activity, numbered, with Work in focus", async () => {
    const shell = await renderShell({
      work: WORK,
      loadNote: (_, issue) =>
        ok(issue === null ? null : { ...noteOn("MOB-2841"), body: "Ask QA" as NoteBody }),
      loadActivity: () => ok([activityEntry(NOW - 60_000, MOBILE.workspace, "Opened")]),
    });
    const frame = shell.captureCharFrame();
    for (const title of ["─ 1 Work ─", "─ 2 Today ─", "─ 3 Notes ─", "─ 4 Activity ─"]) {
      expect(frame).toContain(title);
    }
    expect(frame).toContain("MOB-2841  Add biometric login");
    expect(frame).toContain("Ask QA");
    expect(frame).toContain("13:58  Opened");
    expect(rowContaining(frame, "⏎ open")).toContain("─ t start timer · ⏎ open ─");
    expect(rowContaining(frame, "navigate")).toContain("tab focus");
    expect(frame).toContain("Nothing tracked today.");
    expect(lit(shell, "1 Work")).toBe(true);
    expect(lit(shell, "3 Notes")).toBe(false);
  });

  test("tab and shift+tab move the focus round; a digit jumps to a panel", async () => {
    const shell = await renderShell();
    shell.mockInput.pressTab();
    await shell.waitForFrame(() => lit(shell, "2 Today"));
    expect(lit(shell, "1 Work")).toBe(false);
    expect(rowContaining(shell.captureCharFrame(), "⏎ open")).toContain("─ ⏎ open ─");
    shell.mockInput.pressKey("4");
    await shell.waitForFrame(() => lit(shell, "4 Activity"));
    shell.mockInput.pressTab();
    await shell.waitForFrame(() => lit(shell, "1 Work"));
    shell.mockInput.pressTab({ shift: true });
    await shell.waitForFrame(() => lit(shell, "4 Activity"));
    shell.mockInput.pressKey("9");
    await shell.renderOnce();
    expect(lit(shell, "4 Activity")).toBe(true);
  });

  test("enter opens the focused panel's section, and the focus waits for the way back", async () => {
    const shell = await renderShell();
    shell.mockInput.pressKey("3");
    await shell.waitForFrame(() => lit(shell, "3 Notes"));
    shell.mockInput.pressEnter();
    await shell.waitForFrame(showing("Notes"));
    shell.mockInput.pressTab();
    shell.mockInput.pressKey("1");
    shell.mockInput.pressEnter();
    await shell.renderOnce();
    expect(shell.captureCharFrame()).toContain("─ Notes ─");
    expect(rowContaining(shell.captureCharFrame(), "navigate")).not.toContain("tab focus");
    shell.mockInput.pressKey("HOME");
    await shell.waitForFrame(showing("Dashboard"));
    expect(lit(shell, "3 Notes")).toBe(true);
  });

  test("Today adds up the day's time, counting the running timer as it goes", async () => {
    const clock = new ManualClock(NOW);
    const midnight = Date.UTC(2026, 9, 6) as Timestamp;
    const asked: Timestamp[] = [];
    const span = (issue: string | null, workspace: string, start: number, end: number | null) => ({
      workspaceId: workspace as WorkspaceId,
      issueKey: issue as IssueKey | null,
      start: start as Timestamp,
      end: end as Timestamp | null,
    });
    const shell = await renderShell(
      {
        clock,
        tickMs: 5,
        loadTracked: (since) => {
          asked.push(since);
          return ok({
            spans: [
              span("MOB-2799", "mobile-banking", midnight - 600_000, midnight + 1_200_000),
              span(null, "ghost", NOW - 3_600_000, NOW - 1_800_000),
              span("MOB-2841", "mobile-banking", NOW - 60_000, null),
            ],
            workspaces: new Map(VIEWS.map((v) => [v.workspace.id as string, v.workspace])),
          });
        },
      },
      { width: 120, height: 30 },
    );
    const frame = shell.captureCharFrame();
    expect(asked).toEqual([midnight]);
    expect(rowContaining(frame, "ghost")).toContain("● ghost");
    expect(rowContaining(frame, "ghost")).toContain("30m");
    expect(rowContaining(frame, "MOB-2799")).toContain("MOB-2799  Mobile Banking");
    expect(rowContaining(frame, "MOB-2799")).toContain("20m");
    expect(rowContaining(frame, "MOB-2841")).toContain(" 1m");
    expect(frame).toContain("─ 51m ─");
    clock.advance(60_000);
    await Bun.sleep(25);
    await shell.waitForFrame(
      (f) => f.includes("─ 52m ─") && rowContaining(f, "MOB-2841").includes(" 2m"),
    );
    expect(asked).toHaveLength(1);
  });

  test("Today is read again when something is recorded and when the day turns", async () => {
    const clock = new ManualClock(NOW);
    const activity = fakeActivity();
    const asked: Timestamp[] = [];
    const shell = await renderShell({
      clock,
      tickMs: 5,
      onRecorded: activity.onRecorded,
      loadTracked: (since) => {
        asked.push(since);
        return asked.length > 1
          ? err(storageError("Unable to read tracked time", "timers.read"))
          : ok({ spans: [], workspaces: new Map() });
      },
    });
    activity.record(activityEntry(NOW, MOBILE.workspace, "Opened"));
    await shell.waitForFrame((f) => f.includes("✗ Unable to read tracked time"));
    clock.set(Date.UTC(2026, 9, 7, 0, 0, 1));
    await Bun.sleep(25);
    await shell.waitForFrame(() => asked.length === 3);
    expect(asked[2]).toBe(Date.UTC(2026, 9, 7) as Timestamp);
  });

  test("enter on Today opens the Timesheet section, which shows the same", async () => {
    const shell = await renderShell();
    shell.mockInput.pressKey("2");
    shell.mockInput.pressEnter();
    const frame = await shell.waitForFrame(showing("Timesheet"));
    expect(frame).toContain("Nothing tracked today.");
  });

  test("at 80×24 the clock is drawn small and the key bar keeps what matters", async () => {
    const clock = new ManualClock(NOW);
    const timer = fakeTimer(
      clock,
      VIEWS.map((v) => v.workspace),
    );
    await timer.toggle(MOBILE.workspace, "MOB-2841" as IssueKey);
    const frame = (
      await renderShell({ clock, work: WORK, timer: timer.current() }, { width: 80, height: 24 })
    ).captureCharFrame();
    for (const row of bigClockRows("00:00:00", "small")) expect(frame).toContain(row);
    expect(frame).toContain("Started Tue 06 Oct 12:59 · running");
    const keys = rowContaining(frame, "q quit");
    expect(keys).toContain("t timer");
    expect(keys).not.toContain("alt+1-9");
    expect(keys).toMatch(/│ : commands $/);
  });
});

describe("Shell refresh", () => {
  const NOW = Date.UTC(2026, 9, 6, 13, 59, 41);

  /** Stands in for another terminal: `change()` is what the cockpit hears after its commit. */
  function elsewhere() {
    const listeners = new Set<() => void>();
    return {
      onExternalChange: (listener: () => void) => {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
      change: () => {
        for (const listener of listeners) listener();
      },
      listening: () => listeners.size,
    };
  }

  test("timer, work and tabs changed in another terminal show up without reopening", async () => {
    const clock = new ManualClock(NOW);
    const timer = fakeTimer(
      clock,
      VIEWS.map((v) => v.workspace),
    );
    const outside = elsewhere();
    let stored: CockpitSnapshot = {
      tabs: fakeTabs(VIEWS, "mobile-banking").initial,
      timer: null,
      work: new Map(),
    };
    const shell = await renderShell({
      clock,
      tickMs: 5,
      reload: () => ok(stored),
      onExternalChange: outside.onExternalChange,
    });
    expect(header(shell.captureCharFrame())).not.toContain("●");

    await timer.toggle(VIEWS[1]?.workspace ?? null, "DEP-7" as IssueKey);
    stored = {
      tabs: fakeTabs(VIEWS, "mobile-banking", "deployd").initial,
      timer: timer.current(),
      work: workIn("deployd", "DEP-7", "Ship it", NOW),
    };
    outside.change();
    const frame = await shell.waitForFrame((f) => header(f).includes("● 00:00:00"));
    expect(header(frame)).toContain(" 1 Mobile Banking  2 deployd ");
    expect(frame.split("\n")[1]).toContain(`${" ".repeat(25)}${"▔".repeat(11)}`);
  });

  test("the Activity section is read again", async () => {
    const outside = elsewhere();
    const activity = fakeActivity();
    const shell = await renderShell({
      navigation: new Map([["mobile-banking", "activity"]]),
      loadActivity: activity.load,
      onRecorded: activity.onRecorded,
      reload: () =>
        ok({ tabs: fakeTabs(VIEWS, "mobile-banking").initial, timer: null, work: new Map() }),
      onExternalChange: outside.onExternalChange,
    });
    await shell.waitForFrame((f) => showing("Activity")(f));
    const before = activity.loads.length;
    outside.change();
    await shell.waitForFrame(() => activity.loads.length > before);
  });

  test("a failed reload is reported and the screen kept", async () => {
    const outside = elsewhere();
    const shell = await renderShell({
      reload: () => err(storageError("Unable to read the timer", "timers.active")),
      onExternalChange: outside.onExternalChange,
    });
    outside.change();
    const frame = await shell.waitForFrame((f) => f.includes("✗ Unable to read the timer"));
    expect(header(frame)).toContain("Mobile Banking");
  });

  test("stops listening when the cockpit closes", async () => {
    const outside = elsewhere();
    const shell = await renderShell({ onExternalChange: outside.onExternalChange });
    expect(outside.listening()).toBe(1);
    shell.renderer.destroy();
    setup = undefined;
    expect(outside.listening()).toBe(0);
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
    expect(header(frame)).toContain("● 00:00:00");
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
    expect(header(again.captureCharFrame())).toContain("● 00:00:00");
    await run(again, "finish");
    const frame = await again.waitForFrame((f) => !f.includes(" Commands "));
    expect(again.work.open().size).toBe(0);
    expect(header(frame)).not.toContain("●");
  });

  test("timer entries follow the timer; their failures stay in the palette", async () => {
    const shell = await paletteShell({
      stopTimer: () =>
        Promise.resolve(err(storageError("Unable to save the timer", "timers.save"))),
    });
    await run(shell, "start timer");
    await shell.waitForFrame((f) => header(f).includes("● 00:00:00"));
    await run(shell, "stop timer");
    await shell.waitForFrame(
      (f) => f.includes("✗ Unable to save the timer") && f.includes(" Commands "),
    );
    shell.mockInput.pressEscape();
    await Bun.sleep(30);
    await shell.waitForFrame((f) => !f.includes(" Commands "));
    expect(header(shell.captureCharFrame())).toContain("● 00:00:00");
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
    expect(header(frame)).toContain("血符   1 Mobile Banking ");
    expect(header(frame)).toContain("Tue 06 Oct  13:59");
    for (const label of ["Dashboard", "Work", "Timesheet", "Activity", "Notes"]) {
      expect(frame).toContain(label);
    }
    expect(frame).toContain("─ 1 Work ─");
    expect(rowContaining(frame, "navigate")).toContain("↑↓ navigate");
    expect(rowContaining(frame, "navigate")).toContain("^W workspaces");
    expect(rowContaining(frame, "navigate")).toContain("q quit");
    expect(rowContaining(frame, "navigate")).toMatch(/│ : commands $/);
  });

  test("says so when the current folder is not a workspace", async () => {
    const frame = (await renderShell({ tabs: fakeTabs(VIEWS).initial })).captureCharFrame();
    expect(header(frame)).toContain("血符  No workspace open");
  });

  test("marks only the selected section, with a lavender block and bold label", async () => {
    const shell = await renderShell();
    const spans = shell.captureSpans().lines.flatMap((line) => line.spans);
    const lavender = RGBA.fromHex(PALETTE.accentSecondary);
    const marked = spans.filter((span) => span.bg.equals(lavender) && span.text.trim() !== "");
    expect(marked.map((span) => span.text.trim())).toEqual(["1 Mobile Banking", "D"]);
    const bold = spans.filter((span) => span.attributes & 1).map((span) => span.text.trim());
    expect(bold).toContain("Dashboard");
    expect(bold).not.toContain("Work");
    expect(shell.captureCharFrame()).toContain("│  D  Dashboard");
  });

  test("sections stand a row apart, and ten of them still fit a 24-row terminal", async () => {
    const plugins = ["Jira", "Git", "PRs", "Jenkins", "Android"].map((label, i) => ({
      id: label.toLowerCase(),
      label,
      icons: { nerd: "\u{e725}", letter: "JGPCA"[i] ?? "X" },
    }));
    const lines = (
      await renderShell({ sections: cockpitSections(plugins) }, { width: 100, height: 24 })
    )
      .captureCharFrame()
      .split("\n");
    const rows = ["Dashboard", "Work", "Jira", "Notes"].map((label) =>
      lines.findIndex((line) => new RegExp(`│  .  ${label}\\b`).test(line)),
    );
    expect(rows).toEqual([3, 5, 7, 21]);
    expect(lines[22]).toMatch(/^╰/);
  });

  test("the nerd icon set marks sections with Nerd Font glyphs", async () => {
    const frame = (await renderShell({ icons: "nerd" })).captureCharFrame();
    expect(frame).toContain("│ \u{f009}  Dashboard");
    expect(frame).toContain("│ \u{f0b1}  Work");
    expect(frame).not.toContain("│  D  Dashboard");
  });

  test("arrow keys and j/k move through sections and wrap at the ends", async () => {
    const shell = await renderShell();
    shell.mockInput.pressArrow("down");
    await shell.waitForFrame((f) => showing("Work")(f));

    shell.mockInput.pressKey("k");
    await shell.waitForFrame((f) => showing("Dashboard")(f));

    shell.mockInput.pressArrow("up");
    await shell.waitForFrame((f) => showing("Notes")(f));

    shell.mockInput.pressKey("j");
    await shell.waitForFrame((f) => showing("Dashboard")(f));
  });

  test("home and end jump to the first and last section", async () => {
    const shell = await renderShell();
    shell.mockInput.pressKey("END");
    await shell.waitForFrame((f) => showing("Notes")(f));
    shell.mockInput.pressKey("HOME");
    await shell.waitForFrame((f) => showing("Dashboard")(f));
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
    expect(header(after)).toContain("Auth Service");

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
    expect(header(frame)).toContain("Mobile Banking");
  });

  test("while the switcher is open, letters go to the query, not the shell", async () => {
    const shell = await renderShell();
    shell.mockInput.pressKey("w", { ctrl: true });
    await shell.waitForFrame((f) => f.includes("Switch workspace"));
    await shell.mockInput.typeText("jq");
    await shell.waitForFrame((f) => f.includes("> jq"));
    expect(shell.quits()).toBe(0);

    shell.mockInput.pressEscape();
    await Bun.sleep(30);
    const closed = await shell.waitForFrame((f) => !f.includes("Switch workspace"));
    expect(header(closed)).toContain("Mobile Banking");
    expect(closed).toContain("─ 1 Work ─");
    shell.mockInput.pressKey("j");
    await shell.waitForFrame((f) => showing("Work")(f));
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
    await shell.waitForFrame((f) => f.includes("Tue 06 Oct  14:00"));
  });

  test("a terminal below 80×24 gets a notice instead of a broken layout", async () => {
    const shell = await renderShell({}, { width: 70, height: 20 });
    const frame = shell.captureCharFrame();
    expect(frame).toContain("Terminal too small");
    expect(frame).toContain("Need 80×24, have 70×20");
    expect(frame).not.toContain("Dashboard");

    shell.resize(80, 24);
    await shell.waitForFrame(showing("Dashboard"));
  });

  test("ascii icons drop glyphs and arrows but keep every label", async () => {
    const frame = (await renderShell({ icons: "ascii" })).captureCharFrame();
    expect(frame).toContain("│  D  Dashboard");
    expect(frame).not.toContain("▔");
    expect(frame.split("\n")[1]).toContain(`       ${"-".repeat(18)}`);
    expect(rowContaining(frame, "navigate")).toContain("j/k navigate");
    expect(rowContaining(frame, "navigate")).toContain("| : commands");
  });

  test("uses the palette: vermilion brand mark, peach for the panel in focus only", async () => {
    const shell = await renderShell();
    const spans = shell.captureSpans().lines.flatMap((line) => line.spans);
    const brand = spans.find((span) => span.text.includes("血符"));
    const peach = RGBA.fromHex(PALETTE.borderFocused);
    expect(brand?.fg.equals(RGBA.fromHex(PALETTE.accentPrimary))).toBe(true);
    expect(spans.find((span) => span.text.includes(" 1 Work "))?.fg.equals(peach)).toBe(true);
    expect(spans.find((span) => span.text.includes(" 3 Notes "))?.fg.equals(peach)).toBe(false);
    expect(spans.find((span) => span.text.includes(" Go "))?.fg.equals(peach)).toBe(false);
  });
});
