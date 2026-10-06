import type { CliRenderer } from "@opentui/core";
import type { AppError } from "../application/errors";
import { unexpected } from "../domain/shared/errors";
import { absolutePath } from "../domain/shared/path";
import { err, ok, type Result } from "../domain/shared/result";
import { systemClock } from "../infrastructure/system/clock";
import type { App } from "./start-app";

/** The terminal the cockpit draws on; tests substitute a headless renderer. */
export interface TuiHost {
  /** False when stdin or stdout is not a TTY (pipes, CI); the cockpit then refuses to start. */
  readonly interactive: boolean;
  createRenderer(): Promise<CliRenderer>;
}

async function workspaceNameAt(app: App, cwd: string): Promise<Result<string | null, AppError>> {
  const path = absolutePath(cwd);
  if (!path.ok) return ok(null);
  const found = await app.workspaces.which(path.value);
  if (!found.ok) return found;
  return ok(found.value?.name ?? null);
}

/** Runs the cockpit until the user quits or the renderer is torn down by a signal. */
export async function runTui(
  app: App,
  host: TuiHost,
  cwd: string,
): Promise<Result<void, AppError>> {
  const workspaceName = await workspaceNameAt(app, cwd);
  if (!workspaceName.ok) return workspaceName;

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
      workspaceName: workspaceName.value,
      onQuit: () => renderer.destroy(),
    });
  } catch (thrown) {
    renderer.destroy();
    return err(unexpected("Unable to draw the terminal UI", thrown));
  }
  app.logger.info("Cockpit opened", { workspace: workspaceName.value });
  await closed;
  app.logger.info("Cockpit closed");
  return ok(undefined);
}
