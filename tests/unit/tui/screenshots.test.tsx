import { afterEach, describe, test } from "bun:test";
import type { TestRendererSetup } from "@opentui/core/testing";
import { testRender } from "@opentui/solid";
import type { TrackedTime } from "../../../src/application/timesheet/queries";
import type { Note, NoteBody } from "../../../src/domain/notes/note";
import { storageError } from "../../../src/domain/shared/errors";
import type { NoteId, WorkspaceId } from "../../../src/domain/shared/ids";
import { err, ok } from "../../../src/domain/shared/result";
import type { Timestamp } from "../../../src/domain/shared/time";
import type { IssueKey } from "../../../src/domain/work/issue-key";
import type { Branch } from "../../../src/plugins/git/domain/branches";
import type { GitStatus } from "../../../src/plugins/git/domain/status";
import { gitPlugin } from "../../../src/plugins/git/plugin";
import { gitView } from "../../../src/plugins/git/tui/git-view";
import { jiraPlugin } from "../../../src/plugins/jira/plugin";
import { jiraView } from "../../../src/plugins/jira/tui/jira-view";
import { cockpitSections, type Section } from "../../../src/tui/shell/sections";
import { Shell, type ShellProps } from "../../../src/tui/shell/shell";
import { activityEntry, fakeActivity } from "../../support/fake-activity";
import { fakeGit } from "../../support/fake-git";
import { fakeJira, jiraChangesFor, jiraIssue } from "../../support/fake-jira";
import { fakeTabs } from "../../support/fake-tabs";
import { fakeTimer } from "../../support/fake-timer";
import { gitSectionFor } from "../../support/git-section";
import { ManualClock } from "../../support/manual-clock";
import { expectScreenshot } from "../../support/screenshot";
import { workIn } from "../../support/work";
import { view } from "../../support/workspace-views";

/**
 * Golden screenshots of the cockpit. Review changes in the PR diff (GitHub renders SVG) or as PNGs
 * from `bun run screenshots`.
 */
const VIEWS = [
  view("mobile-banking", "Mobile Banking", "Banking Client"),
  view("shared-sdk", "Shared SDK", "Banking Client", "missing"),
  view("deployd", "deployd"),
  view("mobile-wallet", "Mobile Wallet"),
  view("auth-service", "Auth Service", "Platform"),
];

/** A working tree mid-change, as git status would read it. */
const DIRTY: GitStatus = {
  branch: "feature/MOB-2841-biometric-login",
  commit: "8c41f2e9d0a7b6c5",
  upstream: "origin/feature/MOB-2841-biometric-login",
  ahead: 2,
  behind: 1,
  changes: [
    {
      path: "app/src/main/java/com/bank/auth/BiometricPrompt.kt",
      from: null,
      staged: "added",
      unstaged: "unchanged",
    },
    {
      path: "app/src/main/java/com/bank/auth/LoginViewModel.kt",
      from: null,
      staged: "modified",
      unstaged: "modified",
    },
    {
      path: "app/src/main/res/values/strings.xml",
      from: null,
      staged: "unchanged",
      unstaged: "modified",
    },
    {
      path: "docs/auth/biometrics.md",
      from: "docs/auth/fingerprint.md",
      staged: "renamed",
      unstaged: "unchanged",
    },
  ],
  conflicts: [],
  untracked: ["app/src/test/java/com/bank/auth/BiometricPromptTest.kt"],
  stashes: 1,
};

const branch = (name: string, extra: Partial<Branch>): Branch => ({
  name,
  remote: null,
  current: false,
  upstream: null,
  ahead: 0,
  behind: 0,
  gone: false,
  committedAt: 0,
  subject: "",
  ...extra,
});

/** Branches of a busy repository, as git for-each-ref would list them. */
const BRANCHES: Branch[] = [
  branch("feature/MOB-2841-biometric-login", {
    current: true,
    upstream: "origin/feature/MOB-2841-biometric-login",
    ahead: 2,
    behind: 1,
    subject: "Add biometric prompt",
  }),
  branch("main", { upstream: "origin/main", subject: "Release 4.12.0" }),
  branch("fix/MOB-2790-session-timeout", {
    upstream: "origin/fix/MOB-2790-session-timeout",
    gone: true,
    subject: "Refresh the token before it expires",
  }),
  branch("spike/compose-login", { subject: "Try the login screen in Compose" }),
  branch("origin/main", { remote: "origin", subject: "Release 4.12.0" }),
  branch("origin/release/4.13", { remote: "origin", subject: "Cut 4.13" }),
];

/** The Git section as the git plugin draws it, reading `status` from a stand-in client. */
const gitSection = (status: GitStatus | null): Section => ({
  id: gitPlugin.id,
  label: gitPlugin.label,
  icons: gitPlugin.icons,
  view: gitView(
    gitSectionFor(
      fakeGit({
        status: () => Promise.resolve(ok(status)),
        commit: () => Promise.resolve(ok("5d1e0c4b3a29")),
        branches: () => Promise.resolve(ok(BRANCHES)),
      }),
      60_000,
    ),
  ),
});

/** Issues assigned to you that are not done, as Jira would list them. */
const MY_ISSUES = [
  jiraIssue("MOB-2841", {
    summary: "Add biometric login to the mobile banking app",
    description: [
      "h3. Why",
      "Customers sign in several times a day and typing a PIN on the go is slow.",
      "",
      "h3. Acceptance criteria",
      "* Face ID and fingerprint unlock the app once enrolled in settings",
      "* Falls back to the PIN after three failed attempts, or when nothing is enrolled",
      "* The biometric prompt names the app and says why it is asking",
      "* Turning it off in settings removes the stored key from the keystore",
      "",
      "Design: see the Login v4 frames.",
    ].join("\n"),
  }),
  jiraIssue("MOB-2790", {
    summary: "Crash when rotating the transfer confirmation screen",
    type: "Bug",
    priority: "Highest",
    status: { name: "In Review", category: "doing" },
  }),
  jiraIssue("MOB-2802", {
    summary: "Show pending card transactions in the account history",
    status: { name: "To Do", category: "todo" },
  }),
  jiraIssue("MOB-2755", {
    summary: "Upgrade the networking stack to OkHttp 5",
    type: "Task",
    status: { name: "Blocked", category: "todo" },
  }),
  jiraIssue("SDK-412", {
    summary: "Expose the session refresh callback in the shared SDK",
    status: { name: "Selected for Development", category: "todo" },
  }),
  jiraIssue("MOB-2611", {
    summary: "Accessibility labels for the payee list",
    priority: "Low",
    status: { name: "Ready for QA", category: "doing" },
  }),
];

/** The Jira section as the jira plugin draws it, over a stand-in Jira. */
const jiraSection: Section = {
  id: jiraPlugin.id,
  label: jiraPlugin.label,
  icons: jiraPlugin.icons,
  view: jiraView({
    changes: jiraChangesFor(fakeJira(MY_ISSUES, 9)).changes,
    jql: "assignee = currentUser() AND statusCategory != Done ORDER BY updated DESC",
    maxResults: 6,
    refreshMs: 60_000,
    timeZone: "UTC",
  }),
};

let setup: TestRendererSetup | undefined;
afterEach(() => {
  setup?.renderer.destroy();
  setup = undefined;
});

async function shell(props: Partial<ShellProps> = {}, size = { width: 100, height: 30 }) {
  const tabs = fakeTabs(VIEWS, "mobile-banking");
  setup = await testRender(
    () => (
      <Shell
        sections={cockpitSections([gitSection(DIRTY)])}
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
        onQuit={() => undefined}
        {...props}
      />
    ),
    size,
  );
  await setup.renderOnce();
  return setup;
}

const NOW = Date.UTC(2026, 9, 6, 13, 59, 41);

/** A timer for `workspace` that ran for `ran` ms, then (if given) sat paused for `paused` ms. */
async function trackedTimer(
  workspace: string,
  ran: number,
  paused?: number,
  issue: string | null = null,
) {
  const clock = new ManualClock(NOW - ran - (paused ?? 0));
  const timer = fakeTimer(
    clock,
    VIEWS.map((v) => v.workspace),
  );
  await timer.toggle(
    VIEWS.find((v) => v.workspace.id === workspace)?.workspace ?? null,
    issue as IssueKey | null,
  );
  clock.advance(ran);
  if (paused !== undefined) {
    await timer.toggle(null);
    clock.advance(paused);
  }
  return { clock, timer: timer.current() };
}

async function openSwitcher(screen: TestRendererSetup, query = "") {
  screen.mockInput.pressKey("w", { ctrl: true });
  await screen.waitForFrame((f) => f.includes("of 5"));
  if (query !== "") {
    await screen.mockInput.typeText(query);
    await screen.waitForFrame((f) => f.includes(`> ${query}`));
  }
}

/** A believable day and a half of activity across three workspaces, newest first. */
function dayOfActivity() {
  const [mobile, , deployd, , auth] = VIEWS.map((v) => v.workspace);
  const at = (hours: number, minutes: number, daysAgo = 0) =>
    Date.UTC(2026, 9, 6 - daysAgo, hours, minutes);
  const issue = (text: string) => ({ kind: "issue" as const, text });
  return [
    activityEntry(at(13, 58), mobile ?? null, "Paused the timer", null, "01:42:18"),
    activityEntry(at(13, 31), auth ?? null, "Moved to group", { kind: "name", text: "Platform" }),
    activityEntry(at(12, 20), mobile ?? null, "Resumed the timer"),
    activityEntry(at(11, 47), mobile ?? null, "Paused the timer", null, "01:01:13"),
    activityEntry(at(10, 46), mobile ?? null, "Started the timer for", issue("MOB-2841")),
    activityEntry(
      at(10, 46),
      mobile ?? null,
      "Started work on",
      issue("MOB-2841"),
      "Add biometric authentication to the login screen",
    ),
    activityEntry(at(10, 45), deployd ?? null, "Stopped the timer", null, "00:38:02"),
    activityEntry(at(10, 7), deployd ?? null, "Started the timer"),
    activityEntry(at(9, 2), mobile ?? null, "Opened"),
    activityEntry(at(18, 12, 1), mobile ?? null, "Stopped the timer", null, "03:12:40"),
    activityEntry(at(18, 12, 1), mobile ?? null, "Finished work on", issue("MOB-2799")),
    activityEntry(at(17, 5, 1), null, "Unrecognised event", {
      kind: "name",
      text: "ReleaseCut v2",
    }),
    activityEntry(at(15, 0, 1), mobile ?? null, "Added", null, "/work/mobile-banking"),
  ].map((entry, i, all) => ({ ...entry, seq: all.length - i }));
}

/** Notes on Mobile Banking and on MOB-2841, one holding a masked credential. */
const OWN_NOTE: Note = {
  id: "n1" as NoteId,
  workspaceId: "mobile-banking" as WorkspaceId,
  issueKey: null,
  body: [
    "Staging needs the VPN; ask Dana in #platform for access.",
    "Release train leaves Thursdays at 15:00.",
    "Login API on staging: token=[REDACTED]",
  ].join("\n") as NoteBody,
  updatedAt: NOW as Timestamp,
};
const ISSUE_NOTE: Note = {
  ...OWN_NOTE,
  id: "n2" as NoteId,
  issueKey: "MOB-2841" as IssueKey,
  body: [
    "Face ID fallback goes to the PIN screen, not the password one.",
    "Ask QA about the flaky BiometricPromptTest on API 28.",
    "Design review on Wednesday.",
  ].join("\n") as NoteBody,
};

/** A day's tracked time: MOB-2841 still running, then other work here and elsewhere. */
function trackedToday(): TrackedTime {
  const span = (workspace: string, issue: string | null, start: number, end: number | null) => ({
    workspaceId: workspace as WorkspaceId,
    issueKey: issue as IssueKey | null,
    start: (NOW - start * 60_000) as Timestamp,
    end: end === null ? null : ((NOW - end * 60_000) as Timestamp),
  });
  return {
    spans: [
      span("mobile-banking", "MOB-2799", 300, 265),
      span("auth-service", null, 240, 220),
      span("mobile-banking", "MOB-2841", 194, 93),
      span("mobile-banking", "MOB-2841", 1, null),
    ],
    workspaces: new Map(VIEWS.map((v) => [v.workspace.id as string, v.workspace])),
  };
}

describe("screenshots", () => {
  test("cockpit", async () => {
    expectScreenshot("cockpit", (await shell()).captureSpans());
  });

  test("cockpit, ascii icons, outside a workspace", async () => {
    const screen = await shell({ icons: "ascii", tabs: fakeTabs(VIEWS).initial });
    expectScreenshot("cockpit-ascii", screen.captureSpans());
  });

  test("cockpit, nerd icons", async () => {
    expectScreenshot("cockpit-nerd", (await shell({ icons: "nerd" })).captureSpans());
  });

  test("cockpit, nerd icons, folded at 80 columns", async () => {
    const screen = await shell({ icons: "nerd" }, { width: 80, height: 24 });
    expectScreenshot("cockpit-nerd-narrow", screen.captureSpans());
  });

  test("several tabs, the third in front", async () => {
    const tabs = fakeTabs(VIEWS, "mobile-banking", "deployd", "auth-service");
    const screen = await shell({
      tabs: tabs.initial,
      activateWorkspace: tabs.activate,
      closeTab: tabs.close,
    });
    expectScreenshot("tabs", screen.captureSpans());
  });

  test("tab change failed", async () => {
    const failed = err(storageError("Unable to save open tabs", "workspace_tabs.save"));
    const tabs = fakeTabs(VIEWS, "mobile-banking", "deployd");
    const screen = await shell({
      tabs: tabs.initial,
      closeTab: () => Promise.resolve(failed),
    });
    screen.mockInput.pressKey("w", { meta: true });
    await screen.waitForFrame((f) => f.includes("Unable to save open tabs"));
    expectScreenshot("tabs-error", screen.captureSpans());
  });

  test("timer running", async () => {
    const screen = await shell(await trackedTimer("mobile-banking", 6_138_000));
    expectScreenshot("timer", screen.captureSpans());
  });

  test("timer paused in another workspace, at 80 columns", async () => {
    const tabs = fakeTabs(VIEWS, "auth-service", "mobile-banking");
    const screen = await shell(
      { tabs: tabs.initial, ...(await trackedTimer("auth-service", 2_700_000, 1_200_000)) },
      { width: 80, height: 24 },
    );
    expectScreenshot("timer-elsewhere", screen.captureSpans());
  });

  test("work in progress, timed", async () => {
    const screen = await shell({
      work: workIn("mobile-banking", "MOB-2841", "Add biometric authentication", NOW - 6_138_000),
      ...(await trackedTimer("mobile-banking", 6_138_000, undefined, "MOB-2841")),
    });
    screen.mockInput.pressKey("j");
    await screen.waitForFrame((f) => f.includes("─ Work ─"));
    expectScreenshot("work", screen.captureSpans());
  });

  test("work in progress at 80 columns: the title gives way", async () => {
    const screen = await shell(
      {
        work: workIn(
          "mobile-banking",
          "MOB-2841",
          "Add biometric authentication to the login screen",
          NOW - 600_000,
        ),
        ...(await trackedTimer("mobile-banking", 600_000, undefined, "MOB-2841")),
      },
      { width: 80, height: 24 },
    );
    expectScreenshot("work-narrow", screen.captureSpans());
  });

  test("dashboard, a working day", async () => {
    const screen = await shell(
      {
        work: workIn(
          "mobile-banking",
          "MOB-2841",
          "Add biometric authentication",
          NOW - 13_260_000,
        ),
        ...(await trackedTimer("mobile-banking", 6_138_000, undefined, "MOB-2841")),
        loadActivity: fakeActivity(dayOfActivity()).load,
        loadNote: (_workspace, issue) => ok(issue === null ? OWN_NOTE : ISSUE_NOTE),
        loadTracked: () => ok(trackedToday()),
      },
      { width: 120, height: 34 },
    );
    expectScreenshot("dashboard", screen.captureSpans());
  });

  test("dashboard at 80 columns, Today in focus", async () => {
    const screen = await shell(
      {
        work: workIn(
          "mobile-banking",
          "MOB-2841",
          "Add biometric authentication",
          NOW - 13_260_000,
        ),
        ...(await trackedTimer("mobile-banking", 6_138_000, undefined, "MOB-2841")),
        loadActivity: fakeActivity(dayOfActivity()).load,
        loadNote: (_workspace, issue) => ok(issue === null ? OWN_NOTE : ISSUE_NOTE),
        loadTracked: () => ok(trackedToday()),
      },
      { width: 80, height: 24 },
    );
    screen.mockInput.pressTab();
    await screen.waitForFrame((f) => f.includes("─ ⏎ open ─"));
    expectScreenshot("dashboard-narrow", screen.captureSpans());
  });

  test("today in the Timesheet section", async () => {
    const screen = await shell({
      navigation: new Map([["mobile-banking", "timesheet"]]),
      loadTracked: () => ok(trackedToday()),
    });
    await screen.waitForFrame((f) => f.includes("─ Timesheet ─"));
    expectScreenshot("today", screen.captureSpans());
  });

  test("nothing in progress", async () => {
    const screen = await shell();
    screen.mockInput.pressKey("j");
    await screen.waitForFrame((f) => f.includes("─ Work ─"));
    expectScreenshot("work-none", screen.captureSpans());
  });

  test("activity in the workspace in front", async () => {
    const activity = fakeActivity(dayOfActivity());
    const screen = await shell({
      work: workIn("mobile-banking", "MOB-2841", "Add biometric authentication", NOW - 13_260_000),
      ...(await trackedTimer("mobile-banking", 6_138_000, 60_000, "MOB-2841")),
      navigation: new Map([["mobile-banking", "activity"]]),
      loadActivity: activity.load,
      onRecorded: activity.onRecorded,
    });
    await screen.waitForFrame((f) => f.includes("─ Activity ─"));
    expectScreenshot("activity", screen.captureSpans());
  });

  test("activity in every workspace, at 80 columns", async () => {
    const activity = fakeActivity(dayOfActivity());
    const screen = await shell(
      {
        tabs: { open: [], active: null },
        navigation: new Map([["", "activity"]]),
        loadActivity: activity.load,
        onRecorded: activity.onRecorded,
      },
      { width: 80, height: 24 },
    );
    await screen.waitForFrame((f) => f.includes("─ Activity ─"));
    expectScreenshot("activity-all", screen.captureSpans());
  });

  test("notes for the workspace and its work in progress", async () => {
    const screen = await shell({
      work: workIn("mobile-banking", "MOB-2841", "Add biometric authentication", NOW - 600_000),
      navigation: new Map([["mobile-banking", "notes"]]),
      loadNote: (_workspace, issue) => ok(issue === null ? OWN_NOTE : ISSUE_NOTE),
    });
    await screen.waitForFrame((f) => f.includes("─ Notes ─"));
    expectScreenshot("notes", screen.captureSpans());
  });

  test("no notes yet, at 80 columns", async () => {
    const screen = await shell(
      {
        work: workIn("mobile-banking", "MOB-2841", "Add biometric authentication", NOW - 600_000),
        navigation: new Map([["mobile-banking", "notes"]]),
      },
      { width: 80, height: 24 },
    );
    await screen.waitForFrame((f) => f.includes("─ Notes ─"));
    expectScreenshot("notes-empty", screen.captureSpans());
  });

  test("editing a note", async () => {
    const screen = await shell({
      work: workIn("mobile-banking", "MOB-2841", "Add biometric authentication", NOW - 600_000),
      navigation: new Map([["mobile-banking", "notes"]]),
      loadNote: (_workspace, issue) => ok(issue === null ? OWN_NOTE : ISSUE_NOTE),
      noteText: () => ok(ISSUE_NOTE.body),
    });
    await screen.waitForFrame((f) => f.includes("─ Notes ─"));
    screen.mockInput.pressKey("i");
    await screen.waitForFrame((f) => f.includes(" Note on MOB-2841 "));
    expectScreenshot("note-editor", screen.captureSpans());
  });

  test("editing a note at 80 columns, with unsaved changes", async () => {
    const screen = await shell(
      { navigation: new Map([["mobile-banking", "notes"]]), noteText: () => ok("") },
      { width: 80, height: 24 },
    );
    await screen.waitForFrame((f) => f.includes("─ Notes ─"));
    screen.mockInput.pressKey("e");
    await screen.waitForFrame((f) => f.includes(" Note on Mobile Banking "));
    await screen.mockInput.typeText("Ask Dana about the staging VPN");
    screen.mockInput.pressEscape();
    await Bun.sleep(30);
    await screen.waitForFrame((f) => f.includes("Unsaved changes"));
    expectScreenshot("note-editor-unsaved", screen.captureSpans());
  });

  test("git status", async () => {
    const screen = await shell({ navigation: new Map([["mobile-banking", "git"]]) });
    await screen.waitForFrame((f) => f.includes("Untracked (1)"));
    expectScreenshot("git", screen.captureSpans());
  });

  test("git, with the keyboard on a file", async () => {
    const screen = await shell({ navigation: new Map([["mobile-banking", "git"]]) });
    await screen.waitForFrame((f) => f.includes("Untracked (1)"));
    screen.mockInput.pressTab();
    screen.mockInput.pressKey("j");
    screen.mockInput.pressKey("j");
    screen.mockInput.pressKey("j");
    await screen.waitForFrame((f) => f.includes("space stage · a stage all · c commit"));
    expectScreenshot("git-focused", screen.captureSpans());
  });

  test("git, writing a commit", async () => {
    const screen = await shell({ navigation: new Map([["mobile-banking", "git"]]) });
    await screen.waitForFrame((f) => f.includes("Untracked (1)"));
    screen.mockInput.pressTab();
    screen.mockInput.pressKey("c");
    await screen.waitForFrame((f) => f.includes(" Commit on feature/MOB-2841-biometric-login "));
    await screen.mockInput.typeText("Add biometric login");
    screen.mockInput.pressEnter();
    screen.mockInput.pressEnter();
    await screen.mockInput.typeText("Falls back to the PIN when no fingerprint is enrolled.");
    await screen.waitForFrame((f) => f.includes("no fingerprint"));
    expectScreenshot("git-commit", screen.captureSpans());
  });

  test("git, picking a branch", async () => {
    const screen = await shell({ navigation: new Map([["mobile-banking", "git"]]) });
    await screen.waitForFrame((f) => f.includes("Untracked (1)"));
    screen.mockInput.pressTab();
    screen.mockInput.pressKey("b");
    await screen.waitForFrame((f) => f.includes("release/4.13"));
    screen.mockInput.pressArrow("down");
    await screen.waitForFrame((f) => f.includes("▸ main"));
    expectScreenshot("git-branches", screen.captureSpans());
  });

  test("git, asking before a push", async () => {
    const screen = await shell({ navigation: new Map([["mobile-banking", "git"]]) });
    await screen.waitForFrame((f) => f.includes("Untracked (1)"));
    screen.mockInput.pressTab();
    screen.mockInput.pressKey("P");
    for (let tries = 0; tries < 50 && !screen.captureCharFrame().includes(" Push? "); tries++) {
      await Bun.sleep(5);
      await screen.renderOnce();
    }
    expectScreenshot("git-push", screen.captureSpans());
  });

  test("jira issues", async () => {
    const screen = await shell({
      sections: cockpitSections([gitSection(DIRTY), jiraSection]),
      navigation: new Map([["mobile-banking", "jira"]]),
    });
    await screen.waitForFrame((f) => f.includes("MOB-2611"));
    screen.mockInput.pressTab();
    screen.mockInput.pressArrow("down");
    await screen.waitForFrame((f) => f.includes("enter details"));
    expectScreenshot("jira", screen.captureSpans());
  });

  test("jira, an issue's details", async () => {
    const screen = await shell({
      sections: cockpitSections([gitSection(DIRTY), jiraSection]),
      navigation: new Map([["mobile-banking", "jira"]]),
    });
    await screen.waitForFrame((f) => f.includes("MOB-2611"));
    screen.mockInput.pressTab();
    screen.mockInput.pressEnter();
    await screen.waitForFrame((f) => f.includes("Acceptance criteria"));
    expectScreenshot("jira-issue", screen.captureSpans());
  });

  test("jira, asking before moving an issue", async () => {
    const screen = await shell({
      sections: cockpitSections([gitSection(DIRTY), jiraSection]),
      navigation: new Map([["mobile-banking", "jira"]]),
    });
    await screen.waitForFrame((f) => f.includes("MOB-2611"));
    screen.mockInput.pressTab();
    screen.mockInput.pressArrow("down");
    screen.mockInput.pressArrow("down");
    await screen.waitForFrame((f) => f.includes("s start work"));
    screen.mockInput.pressKey("s");
    for (
      let tries = 0;
      tries < 50 && !screen.captureCharFrame().includes(" Move MOB-2802? ");
      tries++
    ) {
      await Bun.sleep(5);
      await screen.renderOnce();
    }
    expectScreenshot("jira-move", screen.captureSpans());
  });

  test("git, not a repository, at 80 columns", async () => {
    const screen = await shell(
      {
        sections: cockpitSections([gitSection(null)]),
        navigation: new Map([["mobile-banking", "git"]]),
      },
      { width: 80, height: 24 },
    );
    await screen.waitForFrame((f) => f.includes("is not a git repository"));
    expectScreenshot("git-not-a-repository", screen.captureSpans());
  });

  test("palette", async () => {
    const screen = await shell({
      work: workIn("mobile-banking", "MOB-2841", "Add biometric authentication", NOW - 600_000),
      ...(await trackedTimer("mobile-banking", 600_000, undefined, "MOB-2841")),
    });
    await screen.mockInput.typeText(":");
    await screen.waitForFrame((f) => f.includes(" Commands "));
    expectScreenshot("palette", screen.captureSpans());
  });

  test("palette, asking for a field", async () => {
    const screen = await shell();
    await screen.mockInput.typeText(":");
    await screen.waitForFrame((f) => f.includes(" Commands "));
    screen.mockInput.pressEnter();
    await screen.waitForFrame((f) => f.includes("Issue key"));
    await screen.mockInput.typeText("MOB-2841");
    screen.mockInput.pressEnter();
    await screen.waitForFrame((f) => f.includes("Title (optional)"));
    await screen.mockInput.typeText("Add biometric");
    await screen.waitForFrame((f) => f.includes("> Add biometric"));
    expectScreenshot("palette-fields", screen.captureSpans());
  });

  test("palette, invalid input", async () => {
    const screen = await shell();
    await screen.mockInput.typeText(":");
    await screen.waitForFrame((f) => f.includes(" Commands "));
    screen.mockInput.pressEnter();
    await screen.waitForFrame((f) => f.includes("Issue key"));
    await screen.mockInput.typeText("biometrics");
    screen.mockInput.pressEnter();
    await screen.waitForFrame((f) => f.includes("Issue key is invalid"));
    expectScreenshot("palette-invalid", screen.captureSpans());
  });

  test("terminal too small", async () => {
    const screen = await shell({}, { width: 70, height: 20 });
    expectScreenshot("too-small", screen.captureSpans());
  });

  test("switcher", async () => {
    const screen = await shell();
    await openSwitcher(screen);
    expectScreenshot("switcher", screen.captureSpans());
  });

  test("switcher, switch failed", async () => {
    const screen = await shell({
      activateWorkspace: () =>
        Promise.resolve(err(storageError("Unable to save workspaces", "workspaces.save"))),
    });
    await openSwitcher(screen, "auth");
    screen.mockInput.pressEnter();
    await screen.waitForFrame((f) => f.includes("Unable to save workspaces"));
    expectScreenshot("switcher-error", screen.captureSpans());
  });

  test("switcher, filtered", async () => {
    const screen = await shell();
    await openSwitcher(screen, "mob");
    expectScreenshot("switcher-filtered", screen.captureSpans());
  });
});
