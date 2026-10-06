import type { DiagnosticsReport } from "../application/diagnostics";
import {
  createRedactor,
  isSensitiveKey,
  type Redactor,
  SecretRegistry,
} from "../application/security/redaction";
import { formatDiagnostics, formatError, helpText } from "../cli/format";
import { parseArgs } from "../cli/parse-args";
import { assertNever } from "../domain/shared/assert-never";
import type { ConfigSource } from "../infrastructure/config/load-config";
import { type App, type BootError, startApp } from "./start-app";

/** sysexits(3)-style codes so scripts can tell failure classes apart. */
export const EXIT = { ok: 0, usage: 64, software: 70, io: 74, config: 78 } as const;

interface Writer {
  write(text: string): unknown;
}

export interface CliRuntime {
  readonly argv: readonly string[];
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly home: string;
  readonly version: string;
  readonly stdout: Writer;
  readonly stderr: Writer;
}

/** Credential-named environment variables are masked everywhere XueFu writes output. */
export function registerEnvironmentSecrets(
  env: Readonly<Record<string, string | undefined>>,
  registry: SecretRegistry,
): number {
  let registered = 0;
  for (const [name, value] of Object.entries(env)) {
    if (value !== undefined && isSensitiveKey(name) && registry.register(value)) registered += 1;
  }
  return registered;
}

function exitCodeFor(error: BootError): number {
  switch (error.kind) {
    case "configuration":
      return EXIT.config;
    case "filesystem":
    case "storage":
    case "migration":
      return EXIT.io;
    default:
      return assertNever(error);
  }
}

function describeSource(source: ConfigSource): string {
  switch (source.name) {
    case "defaults":
    case "global":
    case "cli":
      return source.name;
    case "environment":
      return `environment (${source.variables.join(", ")})`;
    default:
      return assertNever(source);
  }
}

function diagnostics(app: App, version: string): DiagnosticsReport {
  return {
    version,
    runtime: { bun: Bun.version, platform: process.platform, arch: process.arch },
    paths: {
      configFile: app.paths.configFile,
      dataDir: app.paths.dataDir,
      databaseFile: app.paths.databaseFile,
      backupDir: app.paths.backupDir,
      logFile: app.paths.logFile,
    },
    config: {
      fileFound: app.configFileFound,
      sources: app.configSources.map(describeSource),
      logLevel: app.config.logging.level,
      icons: app.config.ui.icons,
      telemetry: app.config.telemetry.enabled,
    },
    database: {
      schemaVersion: app.migration.toVersion,
      migrationsAppliedNow: app.migration.applied,
      backupPath: app.migration.backupPath,
    },
  };
}

async function runDiagnostics(
  runtime: CliRuntime,
  redactor: Redactor,
  json: boolean,
  overrides: Readonly<Record<string, unknown>>,
): Promise<number> {
  const started = await startApp({
    env: runtime.env,
    home: runtime.home,
    version: runtime.version,
    overrides,
    redactor,
    reportSinkFailure: (message) => runtime.stderr.write(`${redactor.redactString(message)}\n`),
  });
  if (!started.ok) {
    runtime.stderr.write(`${formatError(started.error, redactor)}\n`);
    return exitCodeFor(started.error);
  }
  const app = started.value;
  try {
    const report = diagnostics(app, runtime.version);
    const text = json
      ? `${JSON.stringify(redactor.redactValue(report), null, 2)}\n`
      : formatDiagnostics(report);
    runtime.stdout.write(redactor.redactString(text));
    return EXIT.ok;
  } finally {
    app.close();
  }
}

export async function runCli(runtime: CliRuntime): Promise<number> {
  const registry = new SecretRegistry();
  registerEnvironmentSecrets(runtime.env, registry);
  const redactor = createRedactor(registry);

  const invocation = parseArgs(runtime.argv);
  if (!invocation.ok) {
    runtime.stderr.write(
      `${formatError(invocation.error, redactor)}\n\n${helpText(runtime.version)}`,
    );
    return EXIT.usage;
  }

  switch (invocation.value.kind) {
    case "help":
      runtime.stdout.write(helpText(runtime.version));
      return EXIT.ok;
    case "version":
      runtime.stdout.write(`${runtime.version}\n`);
      return EXIT.ok;
    case "diagnostics":
      return await runDiagnostics(
        runtime,
        redactor,
        invocation.value.json,
        invocation.value.overrides,
      );
    default:
      return assertNever(invocation.value);
  }
}
