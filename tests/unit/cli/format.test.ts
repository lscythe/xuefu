import { describe, expect, test } from "bun:test";
import type { ActivityEntry } from "../../../src/application/activity/queries";
import type { DiagnosticsReport } from "../../../src/application/diagnostics";
import type { NoteView } from "../../../src/application/notes/queries";
import { createRedactor, SecretRegistry } from "../../../src/application/security/redaction";
import type { WorkView } from "../../../src/application/work/queries";
import type { WorkspaceView } from "../../../src/application/workspace/queries";
import {
  formatActivity,
  formatConfirmation,
  formatDiagnostics,
  formatError,
  formatNoteList,
  formatWorkList,
  formatWorkspaceList,
  helpText,
} from "../../../src/cli/format";
import { configurationError, unexpected } from "../../../src/domain/shared/errors";
import type { WorkspaceId } from "../../../src/domain/shared/ids";
import type { AbsolutePath } from "../../../src/domain/shared/path";
import type { Timestamp } from "../../../src/domain/shared/time";
import type { GroupName, WorkspaceName } from "../../../src/domain/workspace/workspace";

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
      "Open the cockpit",
      "diagnostics",
      "--json",
      "--debug",
      "--log-level",
      "--version",
      "workspace add [path]",
      "workspace remove <id>",
      "workspace which [path]",
      "activity",
      "-n, --limit <count>",
      "note save",
      "note append <text>",
    ]) {
      expect(text).toContain(fragment);
    }
  });

  test("lists plugins' commands after the core's, laid out the same way", () => {
    const text = helpText("0.1.0", [
      {
        group: "git",
        name: "status",
        isDefault: true,
        usage: "",
        minArgs: 0,
        maxArgs: 0,
        flags: {
          workspace: { type: "string", short: "w", value: "<id>", description: "which one" },
          json: { type: "boolean", description: "machine-readable output" },
        },
        summary: "Show the branch",
      },
      {
        group: "git",
        name: "show",
        usage: "<ref>",
        minArgs: 1,
        maxArgs: 1,
        flags: {},
        summary: "Show a commit",
      },
    ]);
    const lines = text.split("\n");
    const at = lines.indexOf("  git [status]                  Show the branch");
    expect(at).toBeGreaterThan(lines.findIndex((line) => line.startsWith("  activity")));
    expect(lines.slice(at, at + 5)).toEqual([
      "  git [status]                  Show the branch",
      "                                  -w, --workspace <id>  which one",
      "                                  --json             machine-readable output",
      "  git show <ref>                Show a commit",
      "",
    ]);
    expect(lines[at + 5]).toBe("Options:");
  });
});

function view(
  id: string,
  name: string,
  path: string,
  options: Partial<Pick<WorkspaceView, "status" | "capabilities">> & { group?: string } = {},
): WorkspaceView {
  return {
    workspace: {
      id: id as WorkspaceId,
      name: name as WorkspaceName,
      path: path as AbsolutePath,
      group: (options.group ?? null) as GroupName | null,
      addedAt: 0 as Timestamp,
      lastActiveAt: null,
    },
    status: options.status ?? "ready",
    capabilities: options.capabilities ?? { git: false, gradle: false },
  };
}

describe("formatWorkspaceList", () => {
  test("renders an aligned table with tools, groups and missing folders", () => {
    const text = formatWorkspaceList([
      view("mobile-banking", "Mobile Banking", "/work/mobile", {
        group: "Client",
        capabilities: { git: true, gradle: true },
      }),
      view("api", "API", "/work/api", { capabilities: { git: true, gradle: false } }),
      view("old", "Old", "/gone", { status: "missing" }),
    ]);
    expect(text).toBe(
      [
        "ID              NAME            GROUP   TOOLS       PATH",
        "mobile-banking  Mobile Banking  Client  git gradle  /work/mobile",
        "api             API             -       git         /work/api",
        "old             Old             -       missing     /gone",
        "",
      ].join("\n"),
    );
  });

  test("aligns names written in wide characters", () => {
    const lines = formatWorkspaceList([
      view("xuefu", "血符", "/a"),
      view("ab", "abcd", "/b"),
    ]).split("\n");
    // 血符 occupies four terminal columns, the same as "abcd".
    expect(lines[1]).toBe("xuefu  血符  -      -      /a");
    expect(lines[2]).toBe("ab     abcd  -      -      /b");
  });

  test("explains how to add the first workspace", () => {
    expect(formatWorkspaceList([])).toContain("xuefu workspace add");
  });
});

describe("formatConfirmation", () => {
  test("shows the prompt details, consequence and how to confirm", () => {
    const text = formatConfirmation(
      {
        title: "Remove workspace",
        severity: "confirm",
        details: [
          { label: "Workspace", value: "Mobile (mobile)" },
          { label: "Folder", value: "/work/mobile" },
        ],
        consequence: "The folder is not deleted.",
        confirmLabel: "Remove",
      },
      "Re-run with --yes to confirm.",
    );
    expect(text).toBe(
      [
        "? Remove workspace",
        "  Workspace  Mobile (mobile)",
        "  Folder     /work/mobile",
        "",
        "  The folder is not deleted.",
        "  Re-run with --yes to confirm.",
        "",
      ].join("\n"),
    );
  });
});

describe("formatWorkList", () => {
  const work = (title: string | null, workspace: WorkView["workspace"]): WorkView => ({
    work: {
      id: "w1" as WorkView["work"]["id"],
      workspaceId: "mobile-banking" as WorkspaceId,
      issueKey: "MOB-2841" as WorkView["work"]["issueKey"],
      title: title as WorkView["work"]["title"],
      startedAt: Date.UTC(2026, 9, 6, 9, 14) as Timestamp,
      endedAt: null,
    },
    workspace,
  });

  test("lists workspace, issue, start time and title in the given zone", () => {
    const workspace = {
      id: "mobile-banking" as WorkspaceId,
      name: "Mobile Banking" as WorkspaceName,
      path: "/work/m" as AbsolutePath,
      group: null,
      addedAt: 0 as Timestamp,
      lastActiveAt: null,
    };
    expect(formatWorkList([work("Biometrics", workspace), work(null, null)], "UTC")).toBe(
      [
        "WORKSPACE                 ISSUE     STARTED           TITLE",
        "Mobile Banking            MOB-2841  Tue 06 Oct 09:14  Biometrics",
        "mobile-banking (removed)  MOB-2841  Tue 06 Oct 09:14  -",
        "",
      ].join("\n"),
    );
  });
});

describe("formatActivity", () => {
  const mobile = {
    id: "mobile-banking" as WorkspaceId,
    name: "Mobile Banking" as WorkspaceName,
    path: "/work/m" as AbsolutePath,
    group: null,
    addedAt: 0 as Timestamp,
    lastActiveAt: null,
  };
  const entry = (
    seq: number,
    iso: string,
    workspace: "mobile" | "removed" | "none",
    description: ActivityEntry["description"],
  ): ActivityEntry => ({
    seq,
    at: Date.parse(iso) as Timestamp,
    workspaceId: workspace === "none" ? null : mobile.id,
    workspace: workspace === "mobile" ? mobile : null,
    description,
  });

  test("groups by day, newest first, in the given zone", () => {
    const entries = [
      entry(4, "2026-10-06T09:56:00Z", "mobile", {
        action: "Paused the timer",
        subject: null,
        detail: "00:42:18",
      }),
      entry(3, "2026-10-06T09:14:00Z", "mobile", {
        action: "Started work on",
        subject: { kind: "issue", text: "MOB-2841" },
        detail: "Add biometric login",
      }),
      entry(2, "2026-10-05T18:00:00Z", "removed", {
        action: "Opened",
        subject: null,
        detail: null,
      }),
      entry(1, "2026-10-05T17:00:00Z", "none", {
        action: "Unrecognised event",
        subject: { kind: "name", text: "FromTheFuture v1" },
        detail: null,
      }),
    ];
    expect(formatActivity(entries, "UTC")).toBe(
      [
        "Tue 06 Oct",
        "  09:56  Mobile Banking            Paused the timer  00:42:18",
        "  09:14  Mobile Banking            Started work on MOB-2841  Add biometric login",
        "Mon 05 Oct",
        "  18:00  mobile-banking (removed)  Opened",
        "  17:00  -                         Unrecognised event FromTheFuture v1",
        "",
      ].join("\n"),
    );
  });
});

describe("formatNoteList", () => {
  const note = (
    issue: string | null,
    body: string,
    workspace: NoteView["workspace"],
  ): NoteView => ({
    note: {
      id: "n1" as NoteView["note"]["id"],
      workspaceId: "mobile-banking" as WorkspaceId,
      issueKey: issue as NoteView["note"]["issueKey"],
      body: body as NoteView["note"]["body"],
      updatedAt: Date.UTC(2026, 9, 6, 9, 14) as Timestamp,
    },
    workspace,
  });
  const mobile = {
    id: "mobile-banking" as WorkspaceId,
    name: "Mobile Banking" as WorkspaceName,
    path: "/work/m" as AbsolutePath,
    group: null,
    addedAt: 0 as Timestamp,
    lastActiveAt: null,
  };

  test("one row per note: its first line, cut to fit", () => {
    expect(
      formatNoteList(
        [
          note(null, "\n  Staging needs the VPN\nand a token", mobile),
          note("MOB-1", `Ask QA ${"about the flaky test ".repeat(4)}`, null),
        ],
        "UTC",
      ),
    ).toBe(
      [
        "WORKSPACE                 ISSUE  UPDATED           NOTE",
        "Mobile Banking            -      Tue 06 Oct 09:14  Staging needs the VPN",
        "mobile-banking (removed)  MOB-1  Tue 06 Oct 09:14  Ask QA about the flaky test about the flaky test…",
        "",
      ].join("\n"),
    );
  });
});
