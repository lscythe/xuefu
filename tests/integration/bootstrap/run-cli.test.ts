import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createTestRenderer, type TestRendererSetup } from "@opentui/core/testing";
import type { AppError } from "../../../src/application/errors";
import { SecretRegistry } from "../../../src/application/security/redaction";
import {
  EXIT,
  exitCodeFor,
  registerEnvironmentSecrets,
  runCli,
} from "../../../src/bootstrap/run-cli";
import type { TuiHost } from "../../../src/bootstrap/run-tui";
import * as errors from "../../../src/domain/shared/errors";
import { MIGRATIONS } from "../../../src/infrastructure/persistence/migrations/catalog";
import { makeTempDir } from "../../support/temp-dir";

let dir: { path: string; cleanup: () => void };
beforeEach(() => {
  dir = makeTempDir();
});
afterEach(() => dir.cleanup());

const NO_TERMINAL: TuiHost = {
  interactive: false,
  createRenderer: () => Promise.reject(new Error("not a terminal")),
};

/** A headless terminal; `screen` resolves once the cockpit has a renderer to draw on. */
function headlessTerminal(): { host: TuiHost; screen: Promise<TestRendererSetup> } {
  const { promise: screen, resolve } = Promise.withResolvers<TestRendererSetup>();
  return {
    host: {
      interactive: true,
      createRenderer: async () => {
        const setup = await createTestRenderer({ width: 100, height: 30 });
        resolve(setup);
        return setup.renderer;
      },
    },
    screen,
  };
}

async function run(
  argv: string[],
  extraEnv: Record<string, string> = {},
  cwd = dir.path,
  tui: TuiHost = NO_TERMINAL,
) {
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
    cwd,
    version: "9.9.9",
    tui,
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

  test("no command outside a terminal explains itself without touching any state", async () => {
    const result = await run([]);
    expect(result.code).toBe(EXIT.usage);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("needs an interactive terminal");
    expect(result.stderr).toContain("xuefu --help");
    expect(existsSync(join(dir.path, "data"))).toBe(false);
  });

  test("no command opens the cockpit, which exits 0 when the user quits", async () => {
    const terminal = headlessTerminal();
    const running = run([], {}, dir.path, terminal.host);
    const screen = await terminal.screen;
    const frame = await screen.waitForFrame((f) => f.includes("XUEFU"));
    expect(frame).toContain("No workspace");
    expect(frame).toContain("Dashboard");
    screen.mockInput.pressKey("q");
    expect(await running).toEqual({ code: EXIT.ok, stdout: "", stderr: "" });
    const log = readFileSync(join(dir.path, "data", "logs", "xuefu.log"), "utf8");
    expect(log).toContain("Cockpit opened");
    expect(log).toContain("Cockpit closed");
  });

  test("a terminal that cannot be set up exits 70", async () => {
    const result = await run([], {}, dir.path, {
      interactive: true,
      createRenderer: () => Promise.reject(new Error("no tty attributes")),
    });
    expect(result.code).toBe(EXIT.software);
    expect(result.stderr).toContain("Unable to start the terminal UI");
  });

  test("diagnostics lists environment overrides as a source", async () => {
    const report = JSON.parse(
      (await run(["diagnostics", "--json"], { XUEFU_LOG_LEVEL: "warn" })).stdout,
    );
    expect(report.config.sources).toContain("environment (XUEFU_LOG_LEVEL)");
  });

  test("a data directory that cannot be created exits 74", async () => {
    const blocker = join(dir.path, "not-a-directory");
    writeFileSync(blocker, "");
    const result = await run(["diagnostics"], { XUEFU_DATA_DIR: join(blocker, "data") });
    expect(result.code).toBe(EXIT.io);
    expect(result.stderr).toContain("Unable to create directory");
  });

  test("a failing log sink warns once on stderr and the command still succeeds", async () => {
    mkdirSync(join(dir.path, "data", "logs", "xuefu.log"), { recursive: true });
    const result = await run(["--debug", "diagnostics"]);
    expect(result.code).toBe(EXIT.ok);
    expect(result.stderr.match(/warning: log sink "file" failed/g)).toHaveLength(1);
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
      schemaVersion: MIGRATIONS.length,
      migrationsAppliedNow: MIGRATIONS.map((m) => m.version),
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
  test("regression: PWD and OLDPWD are working directories, not passwords", () => {
    const registry = new SecretRegistry();
    registerEnvironmentSecrets({ PWD: "/Users/dev/project", OLDPWD: "/Users/dev" }, registry);
    expect(registry.values()).toEqual([]);
  });

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

describe("runCli: workspaces", () => {
  let projects: string;
  let mobile: string;
  beforeEach(() => {
    projects = join(realpathSync(dir.path), "projects");
    mobile = join(projects, "mobile");
    mkdirSync(join(mobile, ".git"), { recursive: true });
    writeFileSync(join(mobile, "settings.gradle.kts"), "");
    mkdirSync(join(projects, "api"), { recursive: true });
  });

  test("an empty registry explains how to add a workspace", async () => {
    const result = await run(["workspace"]);
    expect(result).toMatchObject({ code: EXIT.ok, stderr: "" });
    expect(result.stdout).toContain("xuefu workspace add");
  });

  test("add defaults to the current directory and reports detected tools", async () => {
    const result = await run(["workspace", "add"], {}, mobile);
    expect(result.code).toBe(EXIT.ok);
    expect(result.stdout).toContain("✓ Added workspace mobile");
    expect(result.stdout).toContain(`Folder  ${mobile}`);
    expect(result.stdout).toContain("Tools   git gradle");
  });

  test("add resolves relative paths and accepts name, id and group", async () => {
    const result = await run(
      ["workspace", "add", "api", "--name", "Payments API", "--id", "pay", "--group", "Client"],
      {},
      projects,
    );
    expect(result.code).toBe(EXIT.ok);
    expect(result.stdout).toContain("Group   Client");
    expect(result.stdout).toContain("Tools   none detected");

    const listed = JSON.parse((await run(["workspace", "list", "--json"])).stdout);
    expect(listed).toEqual([
      {
        id: "pay",
        name: "Payments API",
        path: join(projects, "api"),
        group: "Client",
        addedAt: expect.any(String),
        lastActiveAt: null,
        status: "ready",
        capabilities: { git: false, gradle: false },
      },
    ]);
  });

  test("list shows a table", async () => {
    await run(["workspace", "add", mobile]);
    const result = await run(["workspace", "list"]);
    expect(result.stdout.split("\n")[1]).toBe(`mobile  mobile  -      git gradle  ${mobile}`);
  });

  test("registering the same folder twice is a conflict (exit 65)", async () => {
    await run(["workspace", "add", mobile]);
    const result = await run(["workspace", "add", mobile, "--id", "again"]);
    expect(result.code).toBe(EXIT.data);
    expect(result.stderr).toContain("already registered as mobile");
  });

  test("a folder that does not exist exits 74", async () => {
    const result = await run(["workspace", "add", "nope"]);
    expect(result.code).toBe(EXIT.io);
    expect(result.stderr).toContain("Folder does not exist");
  });

  test("an invalid id is a usage error naming the field", async () => {
    const result = await run(["workspace", "add", mobile, "--id", "Not Valid"]);
    expect(result.code).toBe(EXIT.usage);
    expect(result.stderr).toContain("id: lowercase letters");
  });

  test("remove asks for --yes and changes nothing without it", async () => {
    await run(["workspace", "add", mobile]);
    const refused = await run(["workspace", "remove", "mobile"]);
    expect(refused.code).toBe(EXIT.usage);
    expect(refused.stderr).toContain("? Remove workspace");
    expect(refused.stderr).toContain(`Folder     ${mobile}`);
    expect(refused.stderr).toContain("Re-run with --yes to confirm.");
    expect(JSON.parse((await run(["workspace", "list", "--json"])).stdout)).toHaveLength(1);

    const removed = await run(["workspace", "remove", "mobile", "--yes"]);
    expect(removed).toMatchObject({ code: EXIT.ok, stderr: "" });
    expect(removed.stdout).toContain("✓ Removed workspace mobile. The folder was not touched.");
    expect(existsSync(mobile)).toBe(true);
    expect(JSON.parse((await run(["workspace", "list", "--json"])).stdout)).toEqual([]);
  });

  test("the cockpit names the workspace it was opened in and lists it in the switcher", async () => {
    await run(["workspace", "add", mobile, "--name", "Mobile Banking"]);
    const nested = join(mobile, "app");
    mkdirSync(nested);
    const terminal = headlessTerminal();
    const running = run([], {}, nested, terminal.host);
    const screen = await terminal.screen;
    expect(await screen.waitForFrame((f) => f.includes("XUEFU"))).toContain("Mobile Banking");
    screen.mockInput.pressKey("w", { ctrl: true });
    const switcher = await screen.waitForFrame((f) => f.includes("1 of 1"));
    expect(switcher).toContain("● current");
    screen.mockInput.pressEscape();
    await Bun.sleep(30);
    await screen.waitForFrame((f) => !f.includes("Switch workspace"));
    screen.mockInput.pressKey("q");
    expect((await running).code).toBe(EXIT.ok);
  });

  test("removing an unknown workspace exits 66 with a hint", async () => {
    const result = await run(["workspace", "remove", "ghost", "-y"]);
    expect(result.code).toBe(EXIT.noInput);
    expect(result.stderr).toContain("No workspace named ghost");
    expect(result.stderr).toContain("xuefu workspace list");
  });

  test("group and ungroup", async () => {
    await run(["workspace", "add", mobile]);
    expect((await run(["workspace", "group", "mobile", "Client A"])).stdout).toBe(
      "✓ mobile is now in group Client A\n",
    );
    expect((await run(["workspace", "ungroup", "mobile"])).stdout).toBe(
      "✓ mobile is no longer in a group\n",
    );
  });

  test("which prints the workspace containing the folder, or exits 1", async () => {
    await run(["workspace", "add", mobile]);
    const nested = join(mobile, "app", "src");
    mkdirSync(nested, { recursive: true });
    expect(await run(["workspace", "which"], {}, nested)).toEqual({
      code: EXIT.ok,
      stdout: "mobile\n",
      stderr: "",
    });
    const json = await run(["workspace", "which", nested, "--json"]);
    expect(JSON.parse(json.stdout)).toMatchObject({ id: "mobile", path: mobile });

    const outside = await run(["workspace", "which"], {}, projects);
    expect(outside).toEqual({
      code: EXIT.none,
      stdout: "",
      stderr: `Not inside a workspace: ${projects}\n`,
    });
    const outsideJson = await run(["workspace", "which", "--json"], {}, projects);
    expect(outsideJson).toMatchObject({ code: EXIT.none, stdout: "null\n" });
  });

  test("which reports a folder that does not exist", async () => {
    expect((await run(["workspace", "which", "missing"])).code).toBe(EXIT.io);
  });
});

describe("exitCodeFor", () => {
  const prompt = {
    title: "t",
    severity: "confirm",
    details: [],
    consequence: "c",
    confirmLabel: "ok",
  } as const;
  test.each([
    [errors.validationError("v", []), EXIT.usage],
    [errors.confirmationRequired("x.y", prompt, "{}"), EXIT.usage],
    [errors.conflict("c", "workspace", "k"), EXIT.data],
    [errors.notFound("workspace", "k"), EXIT.noInput],
    [errors.configurationError("c", "cli", []), EXIT.config],
    [errors.fileSystemError("f", "/p", "stat"), EXIT.io],
    [errors.storageError("s", "op"), EXIT.io],
    [errors.migrationError("m", 1, "failed"), EXIT.io],
    [errors.timeout("t", 10), EXIT.tempFail],
    [errors.cancelled("c"), EXIT.cancelled],
    [errors.commandNotFound("x.y"), EXIT.software],
    [errors.duplicateCommand("x.y"), EXIT.software],
    [errors.unexpected("u", new Error("boom")), EXIT.software],
  ] as [AppError, number][])("%#: %o exits %i", (error, code) => {
    expect(exitCodeFor(error)).toBe(code);
  });
});
