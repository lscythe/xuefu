import { describe, expect, test } from "bun:test";
import type { DiagnosticsReport } from "../../../src/application/diagnostics";
import { createRedactor, SecretRegistry } from "../../../src/application/security/redaction";
import { formatDiagnostics, formatError, helpText } from "../../../src/cli/format";
import { configurationError, unexpected } from "../../../src/domain/shared/errors";

const report: DiagnosticsReport = {
  version: "0.1.0",
  runtime: { bun: "1.4.2", platform: "darwin", arch: "arm64" },
  paths: {
    configFile: "/home/dev/.config/xuefu/config.yml",
    dataDir: "/home/dev/.local/share/xuefu",
    databaseFile: "/home/dev/.local/share/xuefu/xuefu.db",
    backupDir: "/home/dev/.local/share/xuefu/backups",
    logFile: "/home/dev/.local/share/xuefu/logs/xuefu.log",
  },
  config: {
    fileFound: true,
    sources: ["defaults", "global", "environment (XUEFU_LOG_LEVEL)"],
    logLevel: "debug",
    icons: "unicode",
    telemetry: false,
  },
  database: { schemaVersion: 1, migrationsAppliedNow: [1], backupPath: null },
};

const redactor = () => createRedactor(new SecretRegistry());

describe("formatDiagnostics", () => {
  test("renders aligned human-readable lines", () => {
    const text = formatDiagnostics(report);
    expect(text).toContain("血符 XueFu 0.1.0");
    expect(text).toContain("Config file  /home/dev/.config/xuefu/config.yml (found)");
    expect(text).toContain("Config from  defaults, global, environment (XUEFU_LOG_LEVEL)");
    expect(text).toContain(
      "Database     /home/dev/.local/share/xuefu/xuefu.db (schema v1, applied now: 1)",
    );
    expect(text).toContain("Telemetry    disabled");
  });
});

describe("formatError", () => {
  test("shows location, message and hint for configuration errors", () => {
    const error = configurationError(
      "Invalid configuration in /c.yml",
      "/c.yml",
      [{ path: "logging.level", message: "Invalid option", line: 3, column: 10 }],
      { hint: "Fix the listed keys." },
    );
    expect(formatError(error, redactor())).toBe(
      [
        "✗ Invalid configuration in /c.yml",
        "  logging.level (line 3, column 10): Invalid option",
        "",
        "  Fix the listed keys.",
      ].join("\n"),
    );
  });

  test("redacts secrets from messages, causes and context", () => {
    const registry = new SecretRegistry();
    registry.register("tok-1234567890");
    const error = unexpected(
      "Request failed with tok-1234567890",
      new Error("Bearer abcdefghijk"),
      {
        context: { url: "https://u:p@jira.example.com" },
      },
    );
    const text = formatError(error, createRedactor(registry));
    expect(text).not.toContain("tok-1234567890");
    expect(text).not.toContain("abcdefghijk");
    expect(text).not.toContain("u:p@");
    expect(text).toContain("Error: Bearer [REDACTED]");
  });
});

describe("helpText", () => {
  test("documents commands and global options", () => {
    const text = helpText("0.1.0");
    for (const fragment of [
      "Usage",
      "diagnostics",
      "--json",
      "--debug",
      "--log-level",
      "--version",
    ]) {
      expect(text).toContain(fragment);
    }
  });
});
