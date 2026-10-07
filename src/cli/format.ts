import type { DiagnosticsReport } from "../application/diagnostics";
import type { AppError } from "../application/errors";
import type { Redactor } from "../application/security/redaction";
import type { TimerView } from "../application/timesheet/queries";
import type { WorkspaceView } from "../application/workspace/queries";
import type { ConfirmationPrompt } from "../domain/shared/confirmation";
import { clockDuration, type Timestamp } from "../domain/shared/time";
import { elapsed } from "../domain/timesheet/timer";

export function helpText(version: string): string {
  return `血符 XueFu ${version}: terminal developer cockpit

Usage:
  xuefu [options]               Open the cockpit (needs an interactive terminal)
  xuefu [options] <command>

Commands:
  diagnostics                   Show paths, configuration sources and database state
                                  --json             machine-readable output
  workspace [list]              List workspaces with their tools and folders
                                  --json             machine-readable output
  workspace add [path]          Register a folder (default: the current directory)
                                  --name <name>      display name (default: folder name)
                                  --id <id>          short id (default: derived from the name)
                                  --group <group>    group shown in the switcher
  workspace remove <id>         Stop tracking a workspace; the folder is kept
                                  -y, --yes          confirm without asking
  workspace group <id> <group>  Put a workspace in a group
  workspace ungroup <id>        Take a workspace out of its group
  workspace which [path]        Print the workspace that contains a folder
                                  --json             machine-readable output
  timer [status]                Show the running or paused timer
                                  --json             machine-readable output
  timer start                   Start timing this workspace; stops any other timer
                                  -w, --workspace <id>  another workspace than this folder's
                                  --issue <key>      the issue worked on, e.g. MOB-2841
  timer pause | resume | stop   Pause, resume or stop the timer

Options:
  -h, --help                    Show this help
  -v, --version                 Print the version
      --debug                   Shorthand for --log-level debug
      --log-level <level>       trace | debug | info | warn | error

Environment:
  XUEFU_CONFIG_DIR   Config directory (default ~/.config/xuefu)
  XUEFU_DATA_DIR     Data directory   (default ~/.local/share/xuefu)
  XUEFU_LOG_LEVEL    Log level
`;
}

function row(label: string, value: string): string {
  return `  ${label.padEnd(12)} ${value}`;
}

export function formatDiagnostics(report: DiagnosticsReport): string {
  const { runtime, paths, config, database } = report;
  const applied =
    database.migrationsAppliedNow.length === 0 ? "none" : database.migrationsAppliedNow.join(", ");
  const lines = [
    `血符 XueFu ${report.version}`,
    row("Runtime", `Bun ${runtime.bun} (${runtime.platform} ${runtime.arch})`),
    row("Config file", `${paths.configFile} (${config.fileFound ? "found" : "not found"})`),
    row("Config from", config.sources.join(", ")),
    row("Data dir", paths.dataDir),
    row(
      "Database",
      `${paths.databaseFile} (schema v${database.schemaVersion}, applied now: ${applied})`,
    ),
    row("Backups", paths.backupDir),
    ...(database.backupPath === null ? [] : [row("Backup made", database.backupPath)]),
    row("Log file", paths.logFile),
    row("Log level", config.logLevel),
    row("Icons", config.icons),
    row("Telemetry", config.telemetry ? "enabled" : "disabled"),
  ];
  return `${lines.join("\n")}\n`;
}

// East Asian wide and fullwidth ranges: these characters take two terminal columns.
const WIDE =
  /[\u1100-\u115F\u2E80-\u303E\u3041-\u33FF\u3400-\u4DBF\u4E00-\u9FFF\uA000-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE4F\uFF00-\uFF60\uFFE0-\uFFE6\u{20000}-\u{3FFFD}]/u;

function displayWidth(value: string): number {
  let width = 0;
  for (const char of value) width += WIDE.test(char) ? 2 : 1;
  return width;
}

function table(rows: readonly (readonly string[])[]): string {
  const widths: number[] = [];
  for (const row of rows) {
    row.forEach((cell, i) => {
      widths[i] = Math.max(widths[i] ?? 0, displayWidth(cell));
    });
  }
  const lines = rows.map((row) =>
    row
      .map((cell, i) =>
        i === row.length - 1 ? cell : cell + " ".repeat((widths[i] ?? 0) - displayWidth(cell) + 2),
      )
      .join(""),
  );
  return `${lines.join("\n")}\n`;
}

function tools(view: WorkspaceView): string {
  if (view.status === "missing") return "missing";
  const found = [view.capabilities.git ? "git" : null, view.capabilities.gradle ? "gradle" : null];
  const names = found.filter((name) => name !== null);
  return names.length === 0 ? "-" : names.join(" ");
}

export function formatWorkspaceList(views: readonly WorkspaceView[]): string {
  if (views.length === 0) {
    return "No workspaces yet. Add one with: xuefu workspace add [path]\n";
  }
  return table([
    ["ID", "NAME", "GROUP", "TOOLS", "PATH"],
    ...views.map((view) => [
      view.workspace.id,
      view.workspace.name,
      view.workspace.group ?? "-",
      tools(view),
      view.workspace.path,
    ]),
  ]);
}

/** A confirmation the CLI cannot ask interactively, with how to approve it. */
export function formatConfirmation(prompt: ConfirmationPrompt, howToConfirm: string): string {
  const width = Math.max(...prompt.details.map((d) => displayWidth(d.label)));
  const details = prompt.details.map(
    (d) => `  ${d.label}${" ".repeat(width - displayWidth(d.label))}  ${d.value}`,
  );
  return [
    `? ${prompt.title}`,
    ...details,
    "",
    `  ${prompt.consequence}`,
    `  ${howToConfirm}`,
    "",
  ].join("\n");
}

function issueLines(error: AppError): string[] {
  if (error.kind !== "validation" && error.kind !== "configuration") return [];
  return error.issues.map((issue) => {
    const line = "line" in issue ? issue.line : undefined;
    const column = "column" in issue ? issue.column : undefined;
    const location =
      line === undefined
        ? ""
        : ` (line ${line}${column === undefined ? "" : `, column ${column}`})`;
    return `  ${issue.path === "" ? "document" : issue.path}${location}: ${issue.message}`;
  });
}

/** Human-readable, actionable, redacted error output for the terminal. */
export function formatError(error: AppError, redactor: Redactor): string {
  const lines = [`✗ ${error.message}`, ...issueLines(error)];
  if (error.cause !== undefined) lines.push(`  ${error.cause.name}: ${error.cause.message}`);
  if (error.hint !== undefined) lines.push("", `  ${error.hint}`);
  return lines.map((line) => redactor.redactString(line)).join("\n");
}

/** "Mobile Banking (MOB-2841)"; the workspace id once the workspace has been removed. */
export function timerSubject(view: TimerView): string {
  const name = view.workspace?.name ?? view.timer.workspaceId;
  return view.timer.issueKey === null ? name : `${name} (${view.timer.issueKey})`;
}

export function formatTimerStatus(view: TimerView, now: Timestamp): string {
  const { timer, workspace } = view;
  const state = timer.status === "running" ? "● Running" : "‖ Paused ";
  return [
    `${state}  ${clockDuration(elapsed(timer, now))}`,
    row(
      "Workspace",
      workspace === null ? `${timer.workspaceId} (removed)` : `${workspace.name} (${workspace.id})`,
    ),
    ...(timer.issueKey === null ? [] : [row("Issue", timer.issueKey)]),
    "",
  ].join("\n");
}
