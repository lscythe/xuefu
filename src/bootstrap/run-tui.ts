import type { CliRenderer } from "@opentui/core";
import type { AppError } from "../application/errors";
import type { OpenTabs } from "../application/workspace/queries";
import { unexpected } from "../domain/shared/errors";
import { absolutePath } from "../domain/shared/path";
import { err, ok, type Result } from "../domain/shared/result";
import type { Workspace } from "../domain/workspace/workspace";
import { systemClock } from "../infrastructure/system/clock";
import type { App } from "./start-app";

/** The terminal the cockpit draws on; tests substitute a headless renderer. */
export interface TuiHost {
  /** False when stdin or stdout is not a TTY (pipes, CI); the cockpit then refuses to start. */
  readonly interactive: boolean;
  createRenderer(): Promise<CliRenderer>;
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
): Promise<Result<void, AppError>> {
  const tabs = await startingTabs(app, cwd);
  if (!tabs.ok) return tabs;

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
      workspace: tabs.value.active,
      loadWorkspaces: () => app.workspaces.list(),
      activateWorkspace: async (chosen) => {
        const switched = await activate(app, chosen);
        return switched.ok ? ok(switched.value.active ?? chosen) : switched;
      },
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
