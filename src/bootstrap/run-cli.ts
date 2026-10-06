import { resolve } from "node:path";
import { confirmationTokenFor } from "../application/commands/command";
import type { DiagnosticsReport } from "../application/diagnostics";
import type { AppError } from "../application/errors";
import {
  createRedactor,
  isSensitiveKey,
  type Redactor,
  SecretRegistry,
} from "../application/security/redaction";
import type { WorkspaceView } from "../application/workspace/queries";
import {
  formatConfirmation,
  formatDiagnostics,
  formatError,
  formatWorkspaceList,
  helpText,
} from "../cli/format";
import { type CliCommand, parseArgs } from "../cli/parse-args";
import { assertNever } from "../domain/shared/assert-never";
import { absolutePath } from "../domain/shared/path";
import type { Workspace } from "../domain/workspace/workspace";
import type { ConfigSource } from "../infrastructure/config/load-config";
import { runTui, type TuiHost } from "./run-tui";
import { type App, startApp } from "./start-app";

/**
 * sysexits(3)-style codes so scripts can tell failure classes apart. `none` (1) means a query
 * found nothing, e.g. `workspace which` outside every workspace.
 */
export const EXIT = {
  ok: 0,
  none: 1,
  usage: 64,
  data: 65,
  noInput: 66,
  software: 70,
  io: 74,
  tempFail: 75,
  config: 78,
  cancelled: 130,
} as const;

interface Writer {
  write(text: string): unknown;
}

export interface CliRuntime {
  readonly argv: readonly string[];
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly home: string;
  /** Relative paths given on the command line are resolved against this. */
  readonly cwd: string;
  readonly version: string;
  readonly tui: TuiHost;
  readonly stdout: Writer;
  readonly stderr: Writer;
}

interface Output {
  readonly runtime: CliRuntime;
  readonly redactor: Redactor;
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

export function exitCodeFor(error: AppError): number {
  switch (error.kind) {
    case "validation":
    case "confirmation-required":
      return EXIT.usage;
    case "conflict":
      return EXIT.data;
    case "not-found":
      return EXIT.noInput;
    case "configuration":
      return EXIT.config;
    case "filesystem":
    case "storage":
    case "migration":
      return EXIT.io;
    case "timeout":
      return EXIT.tempFail;
    case "cancelled":
      return EXIT.cancelled;
    case "command-not-found":
    case "duplicate-command":
    case "unexpected":
      return EXIT.software;
    default:
      return assertNever(error);
  }
}

function withHint(error: AppError): AppError {
  if (error.kind === "not-found" && error.entity === "workspace" && error.hint === undefined) {
    return { ...error, hint: "List registered workspaces with: xuefu workspace list" };
  }
  return error;
}

function fail(out: Output, error: AppError): number {
  out.runtime.stderr.write(`${formatError(withHint(error), out.redactor)}\n`);
  return exitCodeFor(error);
}

function print(out: Output, text: string): number {
  out.runtime.stdout.write(out.redactor.redactString(text));
  return EXIT.ok;
}

function printJson(out: Output, value: unknown): number {
  return print(out, `${JSON.stringify(out.redactor.redactValue(value), null, 2)}\n`);
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

function workspaceJson(workspace: Workspace) {
  return {
    id: workspace.id,
    name: workspace.name,
    path: workspace.path,
    group: workspace.group,
    addedAt: new Date(workspace.addedAt).toISOString(),
  };
}

function viewJson(view: WorkspaceView) {
  return { ...workspaceJson(view.workspace), status: view.status, capabilities: view.capabilities };
}

async function listWorkspaces(app: App, out: Output, json: boolean): Promise<number> {
  const listed = await app.workspaces.list();
  if (!listed.ok) return fail(out, listed.error);
  return json
    ? printJson(out, listed.value.map(viewJson))
    : print(out, formatWorkspaceList(listed.value));
}

async function addWorkspace(
  app: App,
  out: Output,
  command: Extract<CliCommand, { kind: "workspace.add" }>,
): Promise<number> {
  const added = await app.commandBus.invoke(app.workspaceCommands.add, {
    path: resolve(out.runtime.cwd, command.path ?? "."),
    ...(command.name === null ? {} : { name: command.name }),
    ...(command.id === null ? {} : { id: command.id }),
    ...(command.group === null ? {} : { group: command.group }),
  });
  if (!added.ok) return fail(out, added.error);
  const { workspace, capabilities } = added.value;
  const tools = [capabilities.git ? "git" : null, capabilities.gradle ? "gradle" : null].filter(
    (tool) => tool !== null,
  );
  return print(
    out,
    [
      `✓ Added workspace ${workspace.id}`,
      `  Name    ${workspace.name}`,
      `  Folder  ${workspace.path}`,
      ...(workspace.group === null ? [] : [`  Group   ${workspace.group}`]),
      `  Tools   ${tools.length === 0 ? "none detected" : tools.join(" ")}`,
      "",
    ].join("\n"),
  );
}

async function removeWorkspace(
  app: App,
  out: Output,
  command: Extract<CliCommand, { kind: "workspace.remove" }>,
): Promise<number> {
  const remove = app.workspaceCommands.remove;
  const input = { id: command.id };
  let removed = await app.commandBus.invoke(remove, input);
  if (!removed.ok && removed.error.kind === "confirmation-required") {
    if (!command.yes) {
      out.runtime.stderr.write(
        out.redactor.redactString(
          formatConfirmation(removed.error.prompt, "Re-run with --yes to confirm."),
        ),
      );
      return EXIT.usage;
    }
    removed = await app.commandBus.invoke(remove, input, {
      confirmation: confirmationTokenFor(removed.error),
    });
  }
  if (!removed.ok) return fail(out, removed.error);
  return print(out, `✓ Removed workspace ${removed.value.id}. The folder was not touched.\n`);
}

async function groupWorkspace(
  app: App,
  out: Output,
  command: Extract<CliCommand, { kind: "workspace.group" }>,
): Promise<number> {
  const assigned = await app.commandBus.invoke(app.workspaceCommands.group, {
    id: command.id,
    group: command.group,
  });
  if (!assigned.ok) return fail(out, assigned.error);
  const { id, group } = assigned.value;
  return print(
    out,
    group === null ? `✓ ${id} is no longer in a group\n` : `✓ ${id} is now in group ${group}\n`,
  );
}

async function whichWorkspace(
  app: App,
  out: Output,
  command: Extract<CliCommand, { kind: "workspace.which" }>,
): Promise<number> {
  const path = absolutePath(resolve(out.runtime.cwd, command.path ?? "."));
  if (!path.ok) return fail(out, path.error);
  const found = await app.workspaces.which(path.value);
  if (!found.ok) return fail(out, found.error);
  const workspace = found.value;
  if (command.json) {
    printJson(out, workspace === null ? null : workspaceJson(workspace));
  } else if (workspace === null) {
    out.runtime.stderr.write(out.redactor.redactString(`Not inside a workspace: ${path.value}\n`));
  } else {
    print(out, `${workspace.id}\n`);
  }
  return workspace === null ? EXIT.none : EXIT.ok;
}

async function openCockpit(app: App, out: Output): Promise<number> {
  const closed = await runTui(app, out.runtime.tui, out.runtime.cwd);
  return closed.ok ? EXIT.ok : fail(out, closed.error);
}

function runCommand(app: App, out: Output, command: CliCommand): Promise<number> | number {
  switch (command.kind) {
    case "cockpit":
      return openCockpit(app, out);
    case "diagnostics": {
      const report = diagnostics(app, out.runtime.version);
      return command.json ? printJson(out, report) : print(out, formatDiagnostics(report));
    }
    case "workspace.list":
      return listWorkspaces(app, out, command.json);
    case "workspace.add":
      return addWorkspace(app, out, command);
    case "workspace.remove":
      return removeWorkspace(app, out, command);
    case "workspace.group":
      return groupWorkspace(app, out, command);
    case "workspace.which":
      return whichWorkspace(app, out, command);
    default:
      return assertNever(command);
  }
}

export async function runCli(runtime: CliRuntime): Promise<number> {
  const registry = new SecretRegistry();
  registerEnvironmentSecrets(runtime.env, registry);
  const out: Output = { runtime, redactor: createRedactor(registry) };

  const invocation = parseArgs(runtime.argv);
  if (!invocation.ok) {
    runtime.stderr.write(
      `${formatError(invocation.error, out.redactor)}\n\n${helpText(runtime.version)}`,
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
    case "run":
      break;
    default:
      return assertNever(invocation.value);
  }

  if (invocation.value.command.kind === "cockpit" && !runtime.tui.interactive) {
    runtime.stderr.write(
      "xuefu needs an interactive terminal to open the cockpit.\n" +
        "Run xuefu --help to see the commands that work in scripts.\n",
    );
    return EXIT.usage;
  }

  const started = await startApp({
    env: runtime.env,
    home: runtime.home,
    version: runtime.version,
    overrides: invocation.value.overrides,
    redactor: out.redactor,
    reportSinkFailure: (message) => runtime.stderr.write(`${out.redactor.redactString(message)}\n`),
  });
  if (!started.ok) return fail(out, started.error);
  const app = started.value;
  try {
    return await runCommand(app, out, invocation.value.command);
  } finally {
    app.close();
  }
}
