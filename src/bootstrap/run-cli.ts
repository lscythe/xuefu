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
import type { TimerView } from "../application/timesheet/queries";
import type { WorkspaceView } from "../application/workspace/queries";
import {
  formatActivity,
  formatConfirmation,
  formatDiagnostics,
  formatError,
  formatNoteList,
  formatStartedTimer,
  formatTimerStatus,
  formatWorkList,
  formatWorkspaceList,
  helpText,
  timerSubject,
  workSubject,
} from "../cli/format";
import { type CliCommand, parseArgs } from "../cli/parse-args";
import type { PluginInvocation } from "../cli/plugin-command";
import { assertNever } from "../domain/shared/assert-never";
import { configurationError, validationError } from "../domain/shared/errors";
import { workspaceId } from "../domain/shared/ids";
import { absolutePath } from "../domain/shared/path";
import { err, ok, type Result } from "../domain/shared/result";
import { clockDuration } from "../domain/shared/time";
import { elapsed } from "../domain/timesheet/timer";
import { issueKey } from "../domain/work/issue-key";
import type { Workspace } from "../domain/workspace/workspace";
import type { ConfigSource } from "../infrastructure/config/load-config";
import { systemClock } from "../infrastructure/system/clock";
import { PLUGIN_COMMANDS, PLUGINS } from "./plugins";
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
  unavailable: 69,
  noPermission: 77,
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
  /** Text piped in; `piped` is false when stdin is a terminal. */
  readonly stdin: { readonly piped: boolean; read(): Promise<string> };
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
    case "process":
      return EXIT.unavailable;
    case "remote":
      return error.status === 401 || error.status === 403 ? EXIT.noPermission : EXIT.unavailable;
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

const HINTS: Readonly<Record<string, string>> = {
  workspace: "List registered workspaces with: xuefu workspace list",
  timer: "Start one with: xuefu timer start",
  work: "Start some with: xuefu work start <issue>",
  note: "Start one with: xuefu note append <text>",
};

function withHint(error: AppError): AppError {
  const hint = error.kind === "not-found" ? HINTS[error.entity] : undefined;
  return hint === undefined || error.hint !== undefined ? error : { ...error, hint };
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
    lastActiveAt:
      workspace.lastActiveAt === null ? null : new Date(workspace.lastActiveAt).toISOString(),
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

function timerJson(view: TimerView) {
  const { timer, workspace } = view;
  return {
    id: timer.id,
    status: timer.status,
    workspaceId: timer.workspaceId,
    workspaceName: workspace?.name ?? null,
    issueKey: timer.issueKey,
    startedAt: new Date(timer.startedAt).toISOString(),
    elapsedMs: elapsed(timer, systemClock.now()),
  };
}

function timerStatus(app: App, out: Output, json: boolean): number {
  const active = app.timers.active();
  if (!active.ok) return fail(out, active.error);
  const view = active.value;
  if (json) {
    printJson(out, view === null ? null : timerJson(view));
  } else if (view === null) {
    out.runtime.stderr.write("No timer is running.\n");
  } else {
    print(out, formatTimerStatus(view, systemClock.now()));
  }
  return view === null ? EXIT.none : EXIT.ok;
}

/** The workspace named on the command line, else the one containing the current directory. */
async function targetWorkspace(
  app: App,
  out: Output,
  given: string | null,
): Promise<Result<string, AppError>> {
  if (given !== null) return ok(given);
  const path = absolutePath(out.runtime.cwd);
  if (!path.ok) return path;
  const found = await app.workspaces.which(path.value);
  if (!found.ok) return found;
  if (found.value !== null) return ok(found.value.id);
  return err(
    validationError(`Not inside a workspace: ${path.value}`, [
      { path: "workspace", message: "pass --workspace <id> or run from a workspace folder" },
    ]),
  );
}

async function startTimer(
  app: App,
  out: Output,
  command: Extract<CliCommand, { kind: "timer.start" }>,
): Promise<number> {
  const workspace = await targetWorkspace(app, out, command.workspace);
  if (!workspace.ok) return fail(out, workspace.error);
  // Without --issue, time the work in progress there, if any.
  const work = command.issue === null ? app.work.inProgress() : null;
  if (work !== null && !work.ok) return fail(out, work.error);
  const issue =
    command.issue ?? work?.value.find((v) => v.work.workspaceId === workspace.value)?.work.issueKey;
  const started = await app.commandBus.invoke(app.timerCommands.start, {
    workspace: workspace.value,
    ...(issue === undefined ? {} : { issue }),
  });
  if (!started.ok) return fail(out, started.error);
  return print(out, `${formatStartedTimer(started.value).join("\n")}\n`);
}

async function changeTimer(
  app: App,
  out: Output,
  action: "pause" | "resume" | "stop",
): Promise<number> {
  const commands = app.timerCommands;
  const command =
    action === "pause" ? commands.pause : action === "resume" ? commands.resume : commands.stop;
  const changed = await app.commandBus.invoke(command, {});
  if (!changed.ok) return fail(out, changed.error);
  const view = changed.value;
  const total = clockDuration(elapsed(view.timer, view.timer.updatedAt));
  const done = { pause: "Paused", resume: "Resumed", stop: "Stopped" }[action];
  const when = action === "stop" ? "after" : "at";
  return print(out, `✓ ${done} the timer for ${timerSubject(view)} ${when} ${total}\n`);
}

function workStatus(app: App, out: Output, json: boolean): number {
  const listed = app.work.inProgress();
  if (!listed.ok) return fail(out, listed.error);
  const views = listed.value;
  if (json) {
    printJson(
      out,
      views.map(({ work, workspace }) => ({
        id: work.id,
        workspaceId: work.workspaceId,
        workspaceName: workspace?.name ?? null,
        issueKey: work.issueKey,
        title: work.title,
        startedAt: new Date(work.startedAt).toISOString(),
      })),
    );
  } else if (views.length === 0) {
    out.runtime.stderr.write("No work in progress. Start with: xuefu work start <issue>\n");
  } else {
    print(out, formatWorkList(views));
  }
  return views.length === 0 ? EXIT.none : EXIT.ok;
}

async function startWork(
  app: App,
  out: Output,
  command: Extract<CliCommand, { kind: "work.start" }>,
): Promise<number> {
  const workspace = await targetWorkspace(app, out, command.workspace);
  if (!workspace.ok) return fail(out, workspace.error);
  const started = await app.commandBus.invoke(app.workCommands.start, {
    workspace: workspace.value,
    issue: command.issue,
    ...(command.title === null ? {} : { title: command.title }),
  });
  if (!started.ok) return fail(out, started.error);
  const { work, finished, timer } = started.value;
  const where = work.workspace?.name ?? work.work.workspaceId;
  return print(
    out,
    [
      ...(finished === null ? [] : [`✓ Finished ${finished.issueKey} in ${where}`]),
      `✓ Working on ${workSubject(work)} in ${where}`,
      ...(timer === null ? [] : formatStartedTimer(timer)),
      "",
    ].join("\n"),
  );
}

async function finishWork(
  app: App,
  out: Output,
  command: Extract<CliCommand, { kind: "work.finish" }>,
): Promise<number> {
  const workspace = await targetWorkspace(app, out, command.workspace);
  if (!workspace.ok) return fail(out, workspace.error);
  const finished = await app.commandBus.invoke(app.workCommands.finish, {
    workspace: workspace.value,
  });
  if (!finished.ok) return fail(out, finished.error);
  const { work, timer } = finished.value;
  return print(
    out,
    [
      `✓ Finished ${workSubject(work)} in ${work.workspace?.name ?? work.work.workspaceId}`,
      ...(timer === null
        ? []
        : [
            `✓ Stopped the timer after ${clockDuration(elapsed(timer.timer, timer.timer.updatedAt))}`,
          ]),
      "",
    ].join("\n"),
  );
}

/** "note for Mobile Banking", or "note on MOB-1 in Mobile Banking". */
function noteSubject(workspace: Workspace, issue: string | null): string {
  return issue === null ? `note for ${workspace.name}` : `note on ${issue} in ${workspace.name}`;
}

const SECRET_WARNING =
  "! This note looks like it holds a secret, such as a token or password. Notes are stored\n" +
  "  unencrypted; keep secrets in your keychain or password manager instead.\n";

async function showNote(
  app: App,
  out: Output,
  command: Extract<CliCommand, { kind: "note.show" }>,
): Promise<number> {
  const workspace = await targetWorkspace(app, out, command.workspace);
  if (!workspace.ok) return fail(out, workspace.error);
  const id = workspaceId(workspace.value);
  if (!id.ok) return fail(out, id.error);
  const issue = command.issue === null ? ok(null) : issueKey(command.issue);
  if (!issue.ok) return fail(out, issue.error);
  const found = app.notes.find(id.value, issue.value);
  if (!found.ok) return fail(out, found.error);
  const { note } = found.value;
  if (command.json) {
    printJson(
      out,
      note === null
        ? null
        : {
            id: note.id,
            workspaceId: note.workspaceId,
            issueKey: note.issueKey,
            body: note.body,
            updatedAt: new Date(note.updatedAt).toISOString(),
          },
    );
  } else if (note === null) {
    const subject = noteSubject(found.value.workspace, issue.value);
    out.runtime.stderr.write(`No ${subject} yet. Start one with: xuefu note append <text>\n`);
  } else {
    print(out, `${note.body}\n`);
  }
  return note === null ? EXIT.none : EXIT.ok;
}

async function changeNote(
  app: App,
  out: Output,
  command: Extract<CliCommand, { kind: "note.save" | "note.append" | "note.clear" }>,
): Promise<number> {
  const workspace = await targetWorkspace(app, out, command.workspace);
  if (!workspace.ok) return fail(out, workspace.error);
  const issue = command.issue === null ? ok(null) : issueKey(command.issue);
  if (!issue.ok) return fail(out, issue.error);
  let body = "";
  if (command.kind === "note.append") body = command.text;
  if (command.kind === "note.save") {
    if (!out.runtime.stdin.piped) {
      return fail(
        out,
        validationError("Pipe the note's text in, for example: pbpaste | xuefu note save", [
          { path: "stdin", message: "is a terminal" },
        ]),
      );
    }
    body = await out.runtime.stdin.read();
  }
  const saved = await app.commandBus.invoke(app.noteCommands.save, {
    workspace: workspace.value,
    body,
    ...(issue.value === null ? {} : { issue: issue.value }),
    ...(command.kind === "note.append" ? { append: true } : {}),
  });
  if (!saved.ok) return fail(out, saved.error);
  const { note, changed, secret } = saved.value;
  const subject = noteSubject(saved.value.workspace, issue.value);
  if (secret) out.runtime.stderr.write(SECRET_WARNING);
  if (note === null && !changed) {
    out.runtime.stderr.write(`No ${subject} to clear.\n`);
    return EXIT.none;
  }
  const done =
    note === null
      ? `✓ Cleared the ${subject}`
      : !changed
        ? `✓ The ${subject} already says that`
        : command.kind === "note.append"
          ? `✓ Added to the ${subject}`
          : `✓ Saved the ${subject}`;
  return print(out, `${done}\n`);
}

function listNotes(app: App, out: Output, json: boolean): number {
  const listed = app.notes.list();
  if (!listed.ok) return fail(out, listed.error);
  const views = listed.value;
  if (json) {
    printJson(
      out,
      views.map(({ note, workspace }) => ({
        id: note.id,
        workspaceId: note.workspaceId,
        workspaceName: workspace?.name ?? null,
        issueKey: note.issueKey,
        body: note.body,
        updatedAt: new Date(note.updatedAt).toISOString(),
      })),
    );
  } else if (views.length === 0) {
    out.runtime.stderr.write("No notes yet. Start one with: xuefu note append <text>\n");
  } else {
    print(out, formatNoteList(views));
  }
  return views.length === 0 ? EXIT.none : EXIT.ok;
}

const ACTIVITY_LIMIT = { default: 20, max: 1000 };

function activityLimit(raw: string | null): Result<number, AppError> {
  if (raw === null) return ok(ACTIVITY_LIMIT.default);
  const limit = Number(raw);
  if (/^\d+$/.test(raw) && limit >= 1 && limit <= ACTIVITY_LIMIT.max) return ok(limit);
  return err(
    validationError(`Limit must be a whole number from 1 to ${ACTIVITY_LIMIT.max}`, [
      { path: "limit", message: `received ${raw}` },
    ]),
  );
}

function showActivity(
  app: App,
  out: Output,
  command: Extract<CliCommand, { kind: "activity" }>,
): number {
  const limit = activityLimit(command.limit);
  if (!limit.ok) return fail(out, limit.error);
  const workspace = command.workspace === null ? null : workspaceId(command.workspace);
  if (workspace !== null && !workspace.ok) return fail(out, workspace.error);
  const page = app.activity.recent({
    limit: limit.value,
    ...(workspace === null ? {} : { workspaceId: workspace.value }),
  });
  if (!page.ok) return fail(out, page.error);
  const { entries, nextCursor } = page.value;
  if (command.json) {
    printJson(
      out,
      entries.map((entry) => ({
        seq: entry.seq,
        at: new Date(entry.at).toISOString(),
        workspaceId: entry.workspaceId,
        workspaceName: entry.workspace?.name ?? null,
        ...entry.description,
      })),
    );
  } else if (entries.length === 0) {
    out.runtime.stderr.write("Nothing recorded yet.\n");
  } else {
    print(out, formatActivity(entries));
    if (nextCursor !== null) {
      out.runtime.stderr.write("Older entries not shown; raise --limit to see them.\n");
    }
  }
  return entries.length === 0 ? EXIT.none : EXIT.ok;
}

async function runPluginCommand(
  app: App,
  out: Output,
  invocation: PluginInvocation,
): Promise<number> {
  const started = app.plugins.find(({ plugin }) => plugin.id === invocation.group);
  const commands = started?.parts.commands;
  if (commands === undefined) {
    const off = PLUGINS.find((plugin) => plugin.id === invocation.group)?.whenOff ?? {
      message: `The ${invocation.group} plugin is turned off`,
      path: `plugins.${invocation.group}.enabled`,
      fix: "set it to true to use it",
    };
    return fail(
      out,
      configurationError(off.message, app.paths.configFile, [{ path: off.path, message: off.fix }]),
    );
  }
  const ran = await commands(invocation, {
    workspace: async (given) => {
      const target = await targetWorkspace(app, out, given);
      if (!target.ok) return target;
      const id = workspaceId(target.value);
      return id.ok ? app.workspaces.find(id.value) : id;
    },
    stdout: (text) => print(out, text),
    stderr: (text) => out.runtime.stderr.write(out.redactor.redactString(text)),
  });
  return ran.ok ? ran.value : fail(out, ran.error);
}

async function openCockpit(app: App, out: Output): Promise<number> {
  const closed = await runTui(app, out.runtime.tui, out.runtime.cwd, (text) =>
    out.redactor.redactString(text),
  );
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
    case "timer.status":
      return timerStatus(app, out, command.json);
    case "timer.start":
      return startTimer(app, out, command);
    case "timer.change":
      return changeTimer(app, out, command.action);
    case "work.status":
      return workStatus(app, out, command.json);
    case "work.start":
      return startWork(app, out, command);
    case "activity":
      return showActivity(app, out, command);
    case "note.show":
      return showNote(app, out, command);
    case "note.save":
    case "note.append":
    case "note.clear":
      return changeNote(app, out, command);
    case "note.list":
      return listNotes(app, out, command.json);
    case "work.finish":
      return finishWork(app, out, command);
    case "plugin":
      return runPluginCommand(app, out, command.invocation);
    default:
      return assertNever(command);
  }
}

export async function runCli(runtime: CliRuntime): Promise<number> {
  const registry = new SecretRegistry();
  registerEnvironmentSecrets(runtime.env, registry);
  const out: Output = { runtime, redactor: createRedactor(registry) };

  const invocation = parseArgs(runtime.argv, PLUGIN_COMMANDS);
  if (!invocation.ok) {
    runtime.stderr.write(
      `${formatError(invocation.error, out.redactor)}\n\n${helpText(runtime.version, PLUGIN_COMMANDS)}`,
    );
    return EXIT.usage;
  }

  switch (invocation.value.kind) {
    case "help":
      runtime.stdout.write(helpText(runtime.version, PLUGIN_COMMANDS));
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
    secrets: registry,
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
