import type { Component } from "solid-js";
import type { z } from "zod";
import type { AnyCommand } from "../application/commands/command";
import type { CommandBus } from "../application/commands/command-bus";
import type { Clock } from "../application/ports/clock";
import type { Logger } from "../application/ports/logger";
import type { ProcessRunner } from "../application/ports/process-runner";
import type { PluginCommandRunner, PluginCommandSpec } from "../cli/plugin-command";
import { type ConfigurationError, configurationError } from "../domain/shared/errors";
import { err, ok, type Result } from "../domain/shared/result";
import type { SectionProps } from "../tui/shell/section-props";

/** What XueFu lends a plugin when it starts. */
export interface PluginContext {
  /** Runs the plugin's own commands, once XueFu has registered them, as it runs every command. */
  readonly bus: Pick<CommandBus, "invoke">;
  readonly processes: ProcessRunner;
  readonly logger: Logger;
  readonly clock: Clock;
}

/** What a started plugin adds to XueFu; each part is optional. */
export interface PluginParts {
  /** Runs the commands the plugin declared. */
  readonly commands?: PluginCommandRunner;
  /**
   * What the plugin can do, registered on the command bus so validation, confirmation and logging
   * apply as they do to the core's. Each is named under the plugin's id, as `git.commit`.
   */
  readonly actions?: readonly AnyCommand[];
  /**
   * Draws the plugin's section in the cockpit, under its label and icons. Loaded lazily, so
   * commands that never open the cockpit never load the terminal UI.
   */
  readonly view?: Component<SectionProps>;
}

/** Every plugin's settings can turn it off. */
export interface PluginSettings {
  readonly enabled: boolean;
}

interface PluginDefinition<Settings extends PluginSettings> {
  /** Names the plugin everywhere: `plugins.<id>` in config, `xuefu <id>` on the command line. */
  readonly id: string;
  readonly label: string;
  /** One column each: a Nerd Font glyph, and a capital for any other font. */
  readonly icons: { readonly nerd: string; readonly letter: string };
  /** Known before XueFu starts, so arguments are checked and help written without it. */
  readonly commands: readonly PluginCommandSpec[];
  /** Parses `plugins.<id>` from config, filling in defaults; `{}` must be valid. */
  readonly settings: z.ZodType<Settings>;
  start(context: PluginContext, settings: Settings): PluginParts;
}

/** A plugin with its settings' type sealed in, so plugins of every kind fit in one list. */
export interface Plugin {
  readonly id: string;
  readonly label: string;
  readonly icons: { readonly nerd: string; readonly letter: string };
  readonly commands: readonly PluginCommandSpec[];
  /**
   * Checks the plugin's settings, then starts it; null when the settings turn it off. `source`
   * names where the settings came from, for errors.
   */
  start(
    context: PluginContext,
    settings: unknown,
    source: string,
  ): Result<PluginParts | null, ConfigurationError>;
}

export function definePlugin<Settings extends PluginSettings>(
  definition: PluginDefinition<Settings>,
): Plugin {
  const { id, label, icons, commands } = definition;
  return Object.freeze({
    id,
    label,
    icons,
    commands,
    start: (context: PluginContext, settings: unknown, source: string) => {
      const parsed = definition.settings.safeParse(settings ?? {});
      if (!parsed.success) {
        return err(
          configurationError(
            `Invalid settings for the ${label} plugin`,
            source,
            parsed.error.issues.map((issue) => ({
              path: ["plugins", id, ...issue.path.map(String)].join("."),
              message: issue.message,
            })),
          ),
        );
      }
      return ok(parsed.data.enabled ? definition.start(context, parsed.data) : null);
    },
  });
}
