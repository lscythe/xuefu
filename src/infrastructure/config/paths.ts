import { isAbsolute, join } from "node:path";
import { type ConfigurationError, configurationError } from "../../domain/shared/errors";
import { err, ok, type Result } from "../../domain/shared/result";

export interface XueFuPaths {
  readonly configDir: string;
  readonly configFile: string;
  readonly dataDir: string;
  readonly databaseFile: string;
  readonly backupDir: string;
  readonly logDir: string;
  readonly logFile: string;
}

export interface PathEnvironment {
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly home: string;
}

const APP_DIR = "xuefu";

function nonEmpty(value: string | undefined): string | undefined {
  return value === undefined || value === "" ? undefined : value;
}

function invalidOverride(variable: string): ConfigurationError {
  return configurationError(`${variable} must be an absolute path`, "environment", [
    { path: variable, message: "expected an absolute path" },
  ]);
}

/**
 * Resolution order per directory: explicit XUEFU_* override (must be absolute) → XDG base
 * directory (relative values ignored, per the XDG spec) → conventional default under $HOME.
 */
export function resolvePaths({
  env,
  home,
}: PathEnvironment): Result<XueFuPaths, ConfigurationError> {
  if (!isAbsolute(home)) {
    return err(
      configurationError("Unable to determine the home directory", "environment", [
        { path: "HOME", message: "expected an absolute path" },
      ]),
    );
  }

  const resolveDir = (
    override: string,
    xdg: string,
    fallback: readonly string[],
  ): Result<string, ConfigurationError> => {
    const explicit = nonEmpty(env[override]);
    if (explicit !== undefined) {
      return isAbsolute(explicit) ? ok(explicit) : err(invalidOverride(override));
    }
    const base = nonEmpty(env[xdg]);
    if (base !== undefined && isAbsolute(base)) return ok(join(base, APP_DIR));
    return ok(join(home, ...fallback, APP_DIR));
  };

  const configDir = resolveDir("XUEFU_CONFIG_DIR", "XDG_CONFIG_HOME", [".config"]);
  if (!configDir.ok) return configDir;
  const dataDir = resolveDir("XUEFU_DATA_DIR", "XDG_DATA_HOME", [".local", "share"]);
  if (!dataDir.ok) return dataDir;

  const logDir = join(dataDir.value, "logs");
  return ok({
    configDir: configDir.value,
    configFile: join(configDir.value, "config.yml"),
    dataDir: dataDir.value,
    databaseFile: join(dataDir.value, "xuefu.db"),
    backupDir: join(dataDir.value, "backups"),
    logDir,
    logFile: join(logDir, "xuefu.log"),
  });
}
