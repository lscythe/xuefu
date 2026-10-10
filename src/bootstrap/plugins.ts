import { type ConfigurationError, configurationError } from "../domain/shared/errors";
import { err, ok, type Result } from "../domain/shared/result";
import { gitPlugin } from "../plugins/git/plugin";
import type { Plugin, PluginContext, PluginParts } from "../plugins/plugin";

/** Every built-in plugin, in the order they appear. */
export const PLUGINS: readonly Plugin[] = [gitPlugin];

/** Commands every plugin adds, for parsing arguments and writing help before XueFu starts. */
export const PLUGIN_COMMANDS = PLUGINS.flatMap((plugin) => plugin.commands);

export interface StartedPlugin {
  readonly plugin: Plugin;
  readonly parts: PluginParts;
}

/**
 * Starts the plugins their settings leave on. Settings for a plugin that does not exist are an
 * error, since they are most likely a typo for one that does.
 */
export function startPlugins(
  plugins: readonly Plugin[],
  context: PluginContext,
  settings: Readonly<Record<string, unknown>>,
  source: string,
): Result<readonly StartedPlugin[], ConfigurationError> {
  const known = new Set(plugins.map((plugin) => plugin.id));
  const unknown = Object.keys(settings).filter((id) => !known.has(id));
  if (unknown.length > 0) {
    return err(
      configurationError(
        "Settings for a plugin XueFu does not have",
        source,
        unknown.map((id) => ({
          path: `plugins.${id}`,
          message: `no plugin named "${id}"; plugins: ${[...known].join(", ")}`,
        })),
      ),
    );
  }
  const started: StartedPlugin[] = [];
  for (const plugin of plugins) {
    const parts = plugin.start(context, settings[plugin.id], source);
    if (!parts.ok) return parts;
    if (parts.value !== null) started.push({ plugin, parts: parts.value });
  }
  return ok(started);
}
