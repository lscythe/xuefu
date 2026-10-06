import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { SecretRegistry } from "../../../src/application/security/redaction";
import { EXIT, registerEnvironmentSecrets, runCli } from "../../../src/bootstrap/run-cli";
import { makeTempDir } from "../../support/temp-dir";

let dir: { path: string; cleanup: () => void };
beforeEach(() => {
  dir = makeTempDir();
});
afterEach(() => dir.cleanup());

async function run(argv: string[], extraEnv: Record<string, string> = {}) {
  let stdout = "";
  let stderr = "";
  const code = await runCli({
    argv,
    env: {
      XUEFU_CONFIG_DIR: join(dir.path, "config"),
      XUEFU_DATA_DIR: join(dir.path, "data"),
      ...extraEnv,
    },
    home: dir.path,
    version: "9.9.9",
    stdout: {
      write: (s) => {
        stdout += s;
      },
    },
    stderr: {
      write: (s) => {
        stderr += s;
      },
    },
  });
  return { code, stdout, stderr };
}

describe("runCli", () => {
  test("--version prints the version", async () => {
    expect(await run(["--version"])).toEqual({ code: EXIT.ok, stdout: "9.9.9\n", stderr: "" });
  });

  test("usage errors exit 64 and print help to stderr", async () => {
    const result = await run(["--bogus"]);
    expect(result.code).toBe(EXIT.usage);
    expect(result.stderr).toContain("--bogus");
    expect(result.stderr).toContain("Usage");
  });

  test("diagnostics creates and migrates the database and reports paths", async () => {
    const result = await run(["diagnostics", "--json"]);
    expect(result.code).toBe(EXIT.ok);
    const report = JSON.parse(result.stdout);
    expect(report.version).toBe("9.9.9");
    expect(report.database).toEqual({
      schemaVersion: 1,
      migrationsAppliedNow: [1],
      backupPath: null,
    });
    expect(report.config.fileFound).toBe(false);
    expect(existsSync(join(dir.path, "data", "xuefu.db"))).toBe(true);
    expect(existsSync(join(dir.path, "data", "logs", "xuefu.log"))).toBe(true);
  });

  test("a second run is idempotent", async () => {
    await run(["diagnostics", "--json"]);
    const second = JSON.parse((await run(["diagnostics", "--json"])).stdout);
    expect(second.database.migrationsAppliedNow).toEqual([]);
  });

  test("writes structured log records", async () => {
    await run(["diagnostics"]);
    const lines = readFileSync(join(dir.path, "data", "logs", "xuefu.log"), "utf8")
      .trim()
      .split("\n");
    const records = lines.map((l) => JSON.parse(l));
    expect(records.some((r) => r.msg === "XueFu started" && r.version === "9.9.9")).toBe(true);
  });

  test("--debug raises the log level", async () => {
    const report = JSON.parse((await run(["--debug", "diagnostics", "--json"])).stdout);
    expect(report.config.logLevel).toBe("debug");
    expect(report.config.sources).toContain("cli");
  });

  test("invalid configuration exits 78 with an actionable message", async () => {
    mkdirSync(join(dir.path, "config"), { recursive: true });
    writeFileSync(join(dir.path, "config", "config.yml"), "version: 1\nlogging:\n  level: loud\n");
    const result = await run(["diagnostics"]);
    expect(result.code).toBe(EXIT.config);
    expect(result.stderr).toContain("logging.level (line 3, column 10)");
    expect(result.stderr).toContain("xuefu diagnostics");
  });

  test("invalid environment overrides exit 78 naming the variable", async () => {
    const result = await run(["diagnostics"], { XUEFU_LOG_LEVEL: "verbose" });
    expect(result.code).toBe(EXIT.config);
    expect(result.stderr).toContain("XUEFU_LOG_LEVEL");
  });

  test("a database from a newer XueFu exits with an I/O error and a hint", async () => {
    await run(["diagnostics"]);
    const { Database } = await import("bun:sqlite");
    const db = new Database(join(dir.path, "data", "xuefu.db"));
    db.run("INSERT INTO schema_migrations VALUES (99, 'future', 'x', 0)");
    db.close();
    const result = await run(["diagnostics"]);
    expect(result.code).toBe(EXIT.io);
    expect(result.stderr).toContain("Upgrade XueFu");
  });
});

describe("registerEnvironmentSecrets", () => {
  test("registers values of credential-named variables for masking", () => {
    const registry = new SecretRegistry();
    const count = registerEnvironmentSecrets(
      {
        JIRA_TOKEN: "jira-secret-value",
        BITBUCKET_APP_PASSWORD: "bb-secret-value",
        HOME: "/x",
        EMPTY_TOKEN: "",
      },
      registry,
    );
    expect(count).toBe(2);
    expect(registry.values()).toContain("jira-secret-value");
    expect(registry.values()).not.toContain("/x");
  });
});
