import type { Component } from "solid-js";
import type { z } from "zod";
import type { AnyCommand } from "../application/commands/command";
import type { CommandBus } from "../application/commands/command-bus";
import type { Clock } from "../application/ports/clock";
import type { HttpClient } from "../application/ports/http-client";
import type { Logger } from "../application/ports/logger";
import type { ProcessRunner } from "../application/ports/process-runner";
import type { SecretProvider } from "../application/ports/secret-provider";
import type { PluginCommandRunner, PluginCommandSpec } from "../cli/plugin-command";
import { type ConfigurationError, configurationError } from "../domain/shared/errors";
import { err, ok, type Result } from "../domain/shared/result";
import type { SectionProps } from "../tui/shell/section-props";

/** What XueFu lends a plugin when it starts. */
export interface PluginContext {
  /** Runs the plugin's own commands, once XueFu has registered them, as it runs every command. */
  readonly bus: Pick<CommandBus, "invoke">;
  readonly processes: ProcessRunner;
  readonly http: HttpClient;
  /** Credentials from where config says they are kept; each is masked in every output. */
  readonly secrets: SecretProvider;
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

/** What to tell someone who uses a plugin that is off: what is wrong, and which setting fixes it. */
interface PluginOff {
  readonly message: string;
  readonly path: string;
  readonly fix: string;
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
  /** Defaults to saying the plugin is turned off, and to set `enabled`. */
  readonly whenOff?: PluginOff;
  /** `source` names where the settings came from, for errors that point at them. */
  start(context: PluginContext, settings: Settings, source: string): PluginParts;
}

/** A plugin with its settings' type sealed in, so plugins of every kind fit in one list. */
export interface Plugin {
  readonly id: string;
  readonly label: string;
  readonly icons: { readonly nerd: string; readonly letter: string };
  readonly commands: readonly PluginCommandSpec[];
  readonly whenOff: PluginOff;
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
    whenOff: definition.whenOff ?? {
      message: `The ${label} plugin is turned off`,
      path: `plugins.${id}.enabled`,
      fix: "set it to true to use it",
    },
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
      return ok(parsed.data.enabled ? definition.start(context, parsed.data, source) : null);
    },
  });
}
