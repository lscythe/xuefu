import type { CliRenderer } from "@opentui/core";
import type { AppError } from "../application/errors";
import type { OpenTabs } from "../application/workspace/queries";
import type { NoteBody } from "../domain/notes/note";
import { unexpected } from "../domain/shared/errors";
import { absolutePath } from "../domain/shared/path";
import { err, ok, type Result } from "../domain/shared/result";
import type { Workspace } from "../domain/workspace/workspace";
import { systemClock } from "../infrastructure/system/clock";
import type { CockpitSnapshot } from "../tui/shell/shell";
import type { App } from "./start-app";

/** The terminal the cockpit draws on; tests substitute a headless renderer. */
export interface TuiHost {
  /** False when stdin or stdout is not a TTY (pipes, CI); the cockpit then refuses to start. */
  readonly interactive: boolean;
  createRenderer(): Promise<CliRenderer>;
}

/** More entries than any terminal has rows for. */
const ACTIVITY_PAGE = 200;
/** How often to look for changes made by other XueFu processes; a cheap read. */
const CHANGE_POLL_MS = 500;

/** The timer and work in progress, keyed by workspace id, as stored now. */
function timerAndWork(app: App): Result<Omit<CockpitSnapshot, "tabs">, AppError> {
  const timer = app.timers.active();
  if (!timer.ok) return timer;
  const work = app.work.inProgress();
  if (!work.ok) return work;
  return ok({
    timer: timer.value,
    work: new Map(work.value.map((view) => [view.work.workspaceId as string, view.work])),
  });
}

/** Switches to the workspace (opening or focusing its tab); resolves to the open tabs. */
function activate(app: App, workspace: Workspace): Promise<Result<OpenTabs, AppError>> {
  return app.commandBus.invoke(app.workspaceCommands.activate, { id: workspace.id });
}

/**
 * Tabs to start with: opening XueFu inside a workspace brings its tab to the front; anywhere else
 * the tabs open last time come back as they were.
 */
async function startingTabs(app: App, cwd: string): Promise<Result<OpenTabs, AppError>> {
  const path = absolutePath(cwd);
  const here = path.ok ? await app.workspaces.which(path.value) : ok(null);
  if (!here.ok) return here;
  return here.value === null ? app.workspaces.tabs() : activate(app, here.value);
}

/** Runs the cockpit until the user quits or the renderer is torn down by a signal. */
export async function runTui(
  app: App,
  host: TuiHost,
  cwd: string,
  /** Masks credentials in text shown on screen, as the CLI does in what it prints. */
  redact: (text: string) => string,
): Promise<Result<void, AppError>> {
  const tabs = await startingTabs(app, cwd);
  if (!tabs.ok) return tabs;
  const navigation = app.workspaces.navigation();
  if (!navigation.ok) return navigation;
  const stored = timerAndWork(app);
  if (!stored.ok) return stored;

  // Loaded lazily so plain CLI commands do not pay for OpenTUI's native library.
  const { openShell } = await import("../tui/open-shell");

  let renderer: CliRenderer;
  try {
    renderer = await host.createRenderer();
  } catch (thrown) {
    return err(unexpected("Unable to start the terminal UI", thrown));
  }

  const closed = new Promise<void>((resolve) => renderer.once("destroy", () => resolve()));
  try {
    await openShell(renderer, {
      clock: systemClock,
      icons: app.config.ui.icons,
      tabs: tabs.value,
      loadWorkspaces: () => app.workspaces.list(),
      activateWorkspace: (chosen) => activate(app, chosen),
      closeTab: (closing) =>
        app.commandBus.invoke(app.workspaceCommands.closeTab, { id: closing.id }),
      navigation: navigation.value,
      saveNavigation: (workspace, section) =>
        app.commandBus.invoke(app.workspaceCommands.navigate, {
          id: workspace.id,
          navigation: section,
        }),
      timer: stored.value.timer,
      work: stored.value.work,
      toggleTimer: (front, issue) =>
        app.commandBus.invoke(app.timerCommands.toggle, {
          workspace: front?.id ?? null,
          ...(issue === null ? {} : { issue }),
        }),
      stopTimer: () => app.commandBus.invoke(app.timerCommands.stop, {}),
      startWork: (workspace, issue, title) =>
        app.commandBus.invoke(app.workCommands.start, {
          workspace: workspace.id,
          issue,
          ...(title === null ? {} : { title }),
        }),
      finishWork: (workspace) =>
        app.commandBus.invoke(app.workCommands.finish, { workspace: workspace.id }),
      loadActivity: (front) => {
        const page = app.activity.recent({
          limit: ACTIVITY_PAGE,
          ...(front === null ? {} : { workspaceId: front.id }),
        });
        return page.ok ? ok(page.value.entries) : page;
      },
      onRecorded: (listener) => app.eventBus.subscribe("*", listener, "cockpit.activity"),
      reload: () => {
        const tabsNow = app.workspaces.tabs();
        if (!tabsNow.ok) return tabsNow;
        const now = timerAndWork(app);
        return now.ok ? ok({ tabs: tabsNow.value, ...now.value }) : now;
      },
      loadNote: (workspace, issue) => {
        const found = app.notes.find(workspace.id, issue);
        if (!found.ok) return found;
        const { note } = found.value;
        // Masked for display only; the stored note keeps what was written.
        return ok(note === null ? null : { ...note, body: redact(note.body) as NoteBody });
      },
      loadTracked: (since) => app.timers.trackedSince(since),
      onExternalChange: (listener) => app.changes.watch(listener, CHANGE_POLL_MS),
      onQuit: () => renderer.destroy(),
    });
  } catch (thrown) {
    renderer.destroy();
    return err(unexpected("Unable to draw the terminal UI", thrown));
  }
  app.logger.info("Cockpit opened", { workspace: tabs.value.active?.id ?? null });
  await closed;
  app.logger.info("Cockpit closed");
  return ok(undefined);
}
