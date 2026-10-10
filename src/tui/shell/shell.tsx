import { useKeyboard, useTerminalDimensions } from "@opentui/solid";
import {
  type Accessor,
  batch,
  type Component,
  createMemo,
  createSignal,
  Match,
  onCleanup,
  Show,
  Switch,
} from "solid-js";
import type { ActivityEntry } from "../../application/activity/queries";
import type { AppError } from "../../application/errors";
import type { SavedNote } from "../../application/notes/commands";
import type { Clock } from "../../application/ports/clock";
import type { TimerView, TrackedTime } from "../../application/timesheet/queries";
import type { FinishedWork, StartedWork } from "../../application/work/commands";
import type { OpenTabs, WorkspaceView } from "../../application/workspace/queries";
import type { Note } from "../../domain/notes/note";
import { assertNever } from "../../domain/shared/assert-never";
import { ok, type Result } from "../../domain/shared/result";
import type { Timestamp } from "../../domain/shared/time";
import { startOfDay } from "../../domain/shared/wall-clock";
import { timerToggle } from "../../domain/timesheet/timer";
import type { IssueKey } from "../../domain/work/issue-key";
import type { WorkContext } from "../../domain/work/work-context";
import type { Workspace } from "../../domain/workspace/workspace";
import { ErrorLine } from "../error-line";
import { cycle } from "../list-navigation";
import { NoteEditor } from "../note-editor/note-editor";
import { Palette } from "../palette/palette";
import { Panel } from "../panel";
import { Switcher } from "../switcher/switcher";
import { PALETTE } from "../theme/palette";
import type { IconSet } from "../theme/status";
import { useNow } from "../use-now";
import { ActivityPanel } from "./activity-panel";
import { DASHBOARD_PANELS, Dashboard } from "./dashboard";
import { Header } from "./header";
import { KeyBar } from "./key-bar";
import { actionFor, keyHints } from "./keymap";
import { Nav, navWidth } from "./nav";
import { type LoadedNotes, NotesPanel } from "./notes-panel";
import { paletteEntries } from "./palette-entries";
import { noteKeys, sectionStatus, timerKeys } from "./panel-status";
import type { SectionProps } from "./section-props";
import type { Section } from "./sections";
import { fitsTerminal } from "./terminal-size";
import { TodayPanel, todayTotal } from "./today-panel";
import { TooSmall } from "./too-small";
import { WorkPanel } from "./work-panel";

/** What the cockpit shows from storage, read again when another process changes it. */
export interface CockpitSnapshot {
  readonly tabs: OpenTabs;
  readonly timer: TimerView | null;
  /** Work in progress, keyed by workspace id. */
  readonly work: ReadonlyMap<string, WorkContext>;
}

export interface ShellProps {
  /** The navigation, in order: the core's sections and the plugins'. */
  readonly sections: readonly Section[];
  readonly clock: Clock;
  readonly icons: IconSet;
  /** Tabs to start with; the header shows the one in front. */
  readonly tabs: OpenTabs;
  readonly loadWorkspaces: () => Promise<Result<readonly WorkspaceView[], AppError>>;
  /** Brings the workspace to the front, opening a tab for it if needed, and saves that. */
  readonly activateWorkspace: (workspace: Workspace) => Promise<Result<OpenTabs, AppError>>;
  readonly closeTab: (workspace: Workspace) => Promise<Result<OpenTabs, AppError>>;
  /** Section ids each workspace was left on, from the last session. */
  readonly navigation: ReadonlyMap<string, string>;
  readonly saveNavigation: (
    workspace: Workspace,
    section: string,
  ) => Promise<Result<unknown, AppError>>;
  /** The running or paused timer when the cockpit opened. */
  readonly timer: TimerView | null;
  /** Work in progress, keyed by workspace id. */
  readonly work: ReadonlyMap<string, WorkContext>;
  /**
   * Starts, pauses or resumes the timer for the workspace in front; a new timer is for `issue`.
   * Resolves to null when nothing changed.
   */
  readonly toggleTimer: (
    workspace: Workspace | null,
    issue: IssueKey | null,
  ) => Promise<Result<TimerView | null, AppError>>;
  readonly stopTimer: () => Promise<Result<unknown, AppError>>;
  /** Starts work on `issue` in the workspace, timing it; text is checked by the command. */
  readonly startWork: (
    workspace: Workspace,
    issue: string,
    title: string | null,
  ) => Promise<Result<StartedWork, AppError>>;
  readonly finishWork: (workspace: Workspace) => Promise<Result<FinishedWork, AppError>>;
  /** The latest activity in `workspace`, or in every workspace when null; newest first. */
  readonly loadActivity: (
    workspace: Workspace | null,
  ) => Result<readonly ActivityEntry[], AppError>;
  /** Calls `listener` whenever something is recorded; returns how to stop. */
  readonly onRecorded: (listener: () => void) => () => void;
  readonly reload: () => Result<CockpitSnapshot, AppError>;
  /** The note on `issue` in the workspace, or the workspace's own note when `issue` is null. */
  readonly loadNote: (
    workspace: Workspace,
    issue: IssueKey | null,
  ) => Result<Note | null, AppError>;
  /** The note's text as stored, unmasked, for editing; empty when there is none. */
  readonly noteText: (workspace: Workspace, issue: IssueKey | null) => Result<string, AppError>;
  /** Saves the note's text; blank text clears it. */
  readonly saveNote: (
    workspace: Workspace,
    issue: IssueKey | null,
    text: string,
  ) => Promise<Result<SavedNote, AppError>>;
  /** Time tracked since `since`, in every workspace. */
  readonly loadTracked: (since: Timestamp) => Result<TrackedTime, AppError>;
  /** Calls `listener` when another process, such as a CLI command, changes what is stored. */
  readonly onExternalChange: (listener: () => void) => () => void;
  readonly onQuit: () => void;
  /** IANA zone for the header clock; the host zone when omitted. */
  readonly timeZone?: string;
  readonly tickMs?: number;
}

/** A note open in the editor, with its text as it was when opened. */
interface EditingNote {
  readonly workspace: Workspace;
  readonly issue: IssueKey | null;
  readonly text: string;
}

/** The header's two rows, the panel's frame and the key bar. */
const PANEL_CHROME_ROWS = 5;
/** The panel's frame and padding. */
const PANEL_CHROME_COLUMNS = 4;

export function Shell(props: ShellProps) {
  const dimensions = useTerminalDimensions();
  const [tabs, setTabs] = createSignal(props.tabs);
  const [switcherOpen, setSwitcherOpen] = createSignal(false);
  const [paletteOpen, setPaletteOpen] = createSignal(false);
  const [editing, setEditing] = createSignal<EditingNote | null>(null);
  // Which of the dashboard's panels has focus; kept while away from the dashboard.
  const [panel, setPanel] = createSignal(0);
  const [notice, setNotice] = createSignal<AppError | null>(null);
  // What a plugin's section sets into its frame; cleared when the section changes.
  const [pluginStatus, setPluginStatus] = createSignal<string | null>(null);
  const [timer, setTimer] = createSignal(props.timer);
  const [allWork, setAllWork] = createSignal(props.work);
  // Each workspace keeps its own place in the navigation; "" is the no-workspace screen.
  const [sections, setSections] = createSignal<ReadonlyMap<string, number>>(
    new Map(
      [...props.navigation].flatMap(([id, key]) => {
        const index = props.sections.findIndex((section) => section.id === key);
        return index === -1 ? [] : [[id, index] as const];
      }),
    ),
  );

  // Bumped whenever stored activity may have changed, here or in another process.
  const [recorded, setRecorded] = createSignal(0);
  onCleanup(props.onRecorded(() => setRecorded((n) => n + 1)));

  const workspace = () => tabs().active;
  const work = () => allWork().get(workspace()?.id ?? "") ?? null;
  const selected = () => sections().get(workspace()?.id ?? "") ?? 0;
  const section = () => props.sections[selected()] ?? props.sections[0];
  const select = (index: number) => {
    const current = workspace();
    setSections((all) => new Map(all).set(current?.id ?? "", index));
    const target = props.sections[index];
    setPluginStatus(null);
    if (current === null || target === undefined) return;
    void props.saveNavigation(current, target.id).then((saved) => {
      if (!saved.ok) setNotice(saved.error);
    });
  };

  onCleanup(
    props.onExternalChange(() => {
      const loaded = props.reload();
      if (!loaded.ok) {
        setNotice(loaded.error);
        return;
      }
      batch(() => {
        setTabs(loaded.value.tabs);
        setTimer(loaded.value.timer);
        setAllWork(loaded.value.work);
        setRecorded((n) => n + 1);
      });
    }),
  );

  // Read only while the section is in front, and again whenever something is recorded.
  const showing = (...ids: string[]) => ids.includes(section()?.id ?? "");
  const activity = createMemo(() => {
    if (!showing("activity", "dashboard")) return null;
    recorded();
    return props.loadActivity(workspace());
  });
  const notes = createMemo((): Result<LoadedNotes, AppError> | null => {
    const current = workspace();
    if (!showing("notes", "dashboard") || current === null) return null;
    recorded();
    const own = props.loadNote(current, null);
    if (!own.ok) return own;
    const issue = work()?.issueKey ?? null;
    const onIssue = issue === null ? ok(null) : props.loadNote(current, issue);
    return onIssue.ok ? ok({ own: own.value, issue: onIssue.value }) : onIssue;
  });
  /** Rows left for a section's content once the header, tabs, frame, notice and key bar are drawn. */
  const now = useNow(props.clock, props.tickMs ?? 1000);
  // A new day starts a new total; the memo holds still until midnight.
  const since = createMemo(() => startOfDay(now(), props.timeZone));
  const tracked = createMemo(() => {
    if (!showing("timesheet", "dashboard")) return null;
    recorded();
    return props.loadTracked(since());
  });
  const panelRows = () => dimensions().height - PANEL_CHROME_ROWS - (notice() ? 1 : 0);
  /** Columns right of the sections, where a section or the dashboard is drawn. */
  const areaWidth = () => dimensions().width - nav();
  const nav = () => navWidth(dimensions().width, props.icons, props.sections);
  const toggle = () => timerToggle(timer()?.timer ?? null, workspace()?.id ?? null);

  /** Shows a failure above the key bar; for actions started by a key rather than the palette. */
  const report = (done: Promise<Result<unknown, AppError>>) => {
    void done.then((result) => {
      if (!result.ok) setNotice(result.error);
    });
  };

  /** Applies a tab change once it is saved. */
  const changeTabs = async (change: Promise<Result<OpenTabs, AppError>>) => {
    const changed = await change;
    if (changed.ok) setTabs(changed.value);
    return changed;
  };

  const closeTab = () => {
    const current = workspace();
    return current === null ? Promise.resolve(ok(null)) : changeTabs(props.closeTab(current));
  };

  const toggleTimer = async () => {
    const toggled = await props.toggleTimer(workspace(), work()?.issueKey ?? null);
    if (toggled.ok && toggled.value !== null) setTimer(toggled.value);
    return toggled;
  };

  const stopTimer = async () => {
    const stopped = await props.stopTimer();
    if (stopped.ok) setTimer(null);
    return stopped;
  };

  const setWorkFor = (id: string, next: WorkContext | null) => {
    const all = new Map(allWork());
    if (next === null) all.delete(id);
    else all.set(id, next);
    setAllWork(all);
  };

  const startWork = async (issue: string, title: string | null) => {
    const current = workspace();
    if (current === null) return ok(null);
    const started = await props.startWork(current, issue, title);
    if (started.ok) {
      setWorkFor(current.id, started.value.work.work);
      if (started.value.timer !== null) setTimer(started.value.timer.timer);
    }
    return started;
  };

  const finishWork = async () => {
    const current = workspace();
    if (current === null) return ok(null);
    const finished = await props.finishWork(current);
    if (finished.ok) {
      setWorkFor(current.id, null);
      if (finished.value.timer !== null) setTimer(null);
    }
    return finished;
  };

  /** Opens the editor on the front workspace's note, or on the note on its work in progress. */
  const editNote = (on: "workspace" | "issue") => {
    const current = workspace();
    const issue = on === "issue" ? (work()?.issueKey ?? null) : null;
    if (current === null || (on === "issue" && issue === null)) return;
    const text = props.noteText(current, issue);
    if (!text.ok) {
      setNotice(text.error);
      return;
    }
    setEditing({ workspace: current, issue, text: text.value });
  };

  const move = (to: "previous" | "next" | "first" | "last") => {
    switch (to) {
      case "previous":
        return select(cycle(selected(), -1, props.sections.length));
      case "next":
        return select(cycle(selected(), 1, props.sections.length));
      case "first":
        return select(0);
      case "last":
        return select(props.sections.length - 1);
      default:
        return assertNever(to);
    }
  };

  useKeyboard((key) => {
    const action = actionFor(key);
    // An open overlay owns the keyboard; only Ctrl+C still reaches the shell, except from the
    // note editor, which asks before Ctrl+C drops unsaved text.
    if (editing() !== null) return;
    const overlay = switcherOpen() || paletteOpen();
    if (action === null || (overlay && action.kind !== "interrupt")) return;
    setNotice(null);
    switch (action.kind) {
      case "nav":
        move(action.to);
        return;
      case "switcher.open":
        setSwitcherOpen(true);
        return;
      case "palette.open":
        setPaletteOpen(true);
        return;
      case "tab.focus": {
        const target = tabs().open[action.position - 1];
        if (target !== undefined && target.id !== workspace()?.id) {
          report(changeTabs(props.activateWorkspace(target)));
        }
        return;
      }
      case "tab.close":
        report(closeTab());
        return;
      case "panel.focus":
        if (showing("dashboard")) {
          setPanel(cycle(panel(), action.to === "next" ? 1 : -1, DASHBOARD_PANELS.length));
        }
        return;
      case "panel.jump":
        if (showing("dashboard") && action.position <= DASHBOARD_PANELS.length) {
          setPanel(action.position - 1);
        }
        return;
      case "panel.open": {
        const target = props.sections.findIndex((s) => s.id === DASHBOARD_PANELS[panel()]);
        if (showing("dashboard") && target !== -1) select(target);
        return;
      }
      case "note.edit":
        if (showing("notes") || (showing("dashboard") && DASHBOARD_PANELS[panel()] === "notes")) {
          // The editor takes focus at once; without this the "e" would be typed into it.
          key.preventDefault();
          editNote(action.on);
        }
        return;
      case "timer.toggle":
        report(toggleTimer());
        return;
      case "timer.stop":
        report(stopTimer());
        return;
      case "quit":
      case "interrupt":
        props.onQuit();
        return;
      default:
        assertNever(action);
    }
  });

  return (
    <box flexDirection="column" width="100%" height="100%" backgroundColor={PALETTE.bg}>
      <Show
        when={fitsTerminal(dimensions().width, dimensions().height)}
        fallback={<TooSmall width={dimensions().width} height={dimensions().height} />}
      >
        <Header
          clock={props.clock}
          timeZone={props.timeZone}
          tickMs={props.tickMs ?? 1000}
          icons={props.icons}
          tabs={tabs()}
          timer={timer()}
          width={dimensions().width}
        />
        <box flexDirection="row" flexGrow={1}>
          <Nav sections={props.sections} selected={selected()} icons={props.icons} width={nav()} />
          <Show
            when={!showing("dashboard")}
            fallback={
              <Dashboard
                clock={props.clock}
                timeZone={props.timeZone}
                tickMs={props.tickMs ?? 1000}
                ascii={props.icons === "ascii"}
                workspace={workspace()}
                work={work()}
                timer={timer()}
                notes={notes()}
                activity={activity()}
                tracked={tracked()}
                since={since()}
                width={areaWidth()}
                rows={panelRows() + 2}
                focused={panel()}
                timerKeys={timerKeys(toggle(), props.icons === "ascii")}
              />
            }
          >
            <Panel
              title={section()?.label ?? ""}
              focused
              flexGrow={1}
              status={
                section()?.view === undefined
                  ? sectionStatus(section()?.id, {
                      work: work(),
                      timer: timer(),
                      workspace: workspace(),
                      today: todayTotal(tracked(), since(), now()),
                    })
                  : pluginStatus()
              }
              keys={
                section()?.id === "work"
                  ? timerKeys(toggle(), props.icons === "ascii")
                  : section()?.id === "notes" && workspace() !== null
                    ? noteKeys(work(), props.icons === "ascii")
                    : null
              }
            >
              <Switch fallback={<text fg={PALETTE.textMuted}>Nothing to show yet.</text>}>
                <Match when={section()?.view} keyed>
                  {(View: Component<SectionProps>) => (
                    <View
                      workspace={workspace()}
                      width={areaWidth() - PANEL_CHROME_COLUMNS}
                      rows={panelRows()}
                      icons={props.icons}
                      setStatus={setPluginStatus}
                    />
                  )}
                </Match>
                <Match when={section()?.id === "work"}>
                  <WorkPanel
                    clock={props.clock}
                    timeZone={props.timeZone}
                    tickMs={props.tickMs ?? 1000}
                    workspace={workspace()}
                    work={work()}
                    timer={timer()}
                    width={areaWidth() - PANEL_CHROME_COLUMNS}
                    rows={panelRows()}
                    ascii={props.icons === "ascii"}
                  />
                </Match>
                <Match when={tracked()}>
                  {(loaded: Accessor<Result<TrackedTime, AppError>>) => (
                    <TodayPanel
                      clock={props.clock}
                      tickMs={props.tickMs ?? 1000}
                      tracked={loaded()}
                      since={since()}
                      width={areaWidth() - PANEL_CHROME_COLUMNS}
                      rows={panelRows()}
                      ascii={props.icons === "ascii"}
                    />
                  )}
                </Match>
                <Match when={section()?.id === "notes"}>
                  <NotesPanel
                    workspace={workspace()}
                    work={work()}
                    notes={notes()}
                    ascii={props.icons === "ascii"}
                  />
                </Match>
                <Match when={activity()}>
                  {(loaded: Accessor<Result<readonly ActivityEntry[], AppError>>) => (
                    <ActivityPanel
                      clock={props.clock}
                      timeZone={props.timeZone}
                      tickMs={props.tickMs ?? 1000}
                      workspace={workspace()}
                      activity={loaded()}
                      rows={panelRows()}
                      width={areaWidth() - PANEL_CHROME_COLUMNS}
                      ascii={props.icons === "ascii"}
                    />
                  )}
                </Match>
              </Switch>
            </Panel>
          </Show>
        </box>
        <Show when={notice()}>
          {(error: Accessor<AppError>) => (
            <box paddingX={1} height={1} backgroundColor={PALETTE.panelBg}>
              <ErrorLine error={error()} ascii={props.icons === "ascii"} />
            </box>
          )}
        </Show>
        <KeyBar
          icons={props.icons}
          width={dimensions().width}
          hints={keyHints(props.icons, {
            tabs: tabs().open.length > 0,
            timer: toggle() !== null,
            panels: showing("dashboard"),
          })}
        />
        <Show when={switcherOpen()}>
          <Switcher
            load={props.loadWorkspaces}
            currentId={workspace()?.id ?? null}
            icons={props.icons}
            onChoose={async (chosen) => {
              const activated = await props.activateWorkspace(chosen);
              if (activated.ok) {
                setTabs(activated.value);
                setSwitcherOpen(false);
              }
              return activated;
            }}
            onClose={() => setSwitcherOpen(false)}
          />
        </Show>
        <Show when={paletteOpen()}>
          <Palette
            entries={paletteEntries(
              { workspace: workspace(), work: work(), timer: timer() },
              {
                startWork,
                finishWork,
                toggleTimer,
                stopTimer,
                closeTab,
                openSwitcher: () => {
                  setPaletteOpen(false);
                  setSwitcherOpen(true);
                },
                editNote: (on) => {
                  setPaletteOpen(false);
                  editNote(on);
                },
                quit: props.onQuit,
              },
            )}
            icons={props.icons}
            onClose={() => setPaletteOpen(false)}
          />
        </Show>
        <Show when={editing()}>
          {(note: Accessor<EditingNote>) => (
            <NoteEditor
              subject={note().issue ?? note().workspace.name}
              text={note().text}
              icons={props.icons}
              save={(text) => props.saveNote(note().workspace, note().issue, text)}
              onClose={() => setEditing(null)}
            />
          )}
        </Show>
      </Show>
    </box>
  );
}
