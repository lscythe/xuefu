import type { DiagnosticsReport } from "../application/diagnostics";
import type { AppError } from "../application/errors";
import type { Redactor } from "../application/security/redaction";

export function helpText(version: string): string {
  return `血符 XueFu ${version}: terminal developer cockpit

Usage:
  xuefu [options] <command>

Commands:
  diagnostics        Show paths, configuration sources and database state
                       --json   machine-readable output

Options:
  -h, --help         Show this help
  -v, --version      Print the version
      --debug        Shorthand for --log-level debug
      --log-level    trace | debug | info | warn | error

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
