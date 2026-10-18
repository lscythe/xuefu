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
import { GIT_ENV, makeRepo } from "../../support/git-repo";
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
  stdin: string | null = null,
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
    stdin: {
      piped: stdin !== null,
      read: () => Promise.resolve(stdin ?? ""),
      chunks: () => (stdin === null ? [] : [stdin]),
    },
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
    const frame = await screen.waitForFrame((f) => f.includes("血符"));
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
    expect(await screen.waitForFrame((f) => f.includes("血符"))).toContain("Mobile Banking");
    screen.mockInput.pressKey("w", { ctrl: true });
    const switcher = await screen.waitForFrame((f) => f.includes("1 of 1"));
    expect(switcher).toContain("● current");
    screen.mockInput.pressEscape();
    await Bun.sleep(30);
    await screen.waitForFrame((f) => !f.includes("Switch workspace"));
    screen.mockInput.pressKey("q");
    expect((await running).code).toBe(EXIT.ok);
  });

  test("the cockpit adds, renames, groups and removes workspaces", async () => {
    const terminal = headlessTerminal();
    const running = run([], {}, dir.path, terminal.host);
    const screen = await terminal.screen;
    const header = async () =>
      (await screen.waitForFrame((f) => f.includes("血符"))).split("\n")[0];
    const command = async (title: string) => {
      await screen.mockInput.typeText(":");
      await screen.waitForFrame((f) => f.includes(" Commands "));
      await screen.mockInput.typeText(title);
      await screen.waitForFrame((f) => f.includes(title));
      screen.mockInput.pressEnter();
    };
    const answer = async (label: string, text: string) => {
      await screen.waitForFrame((f) => f.includes(label));
      await screen.mockInput.typeText(text);
      screen.mockInput.pressEnter();
    };
    await header();

    screen.mockInput.pressKey("w", { ctrl: true });
    await screen.waitForFrame((f) => f.includes("Add one with ctrl+a"));
    screen.mockInput.pressKey("a", { ctrl: true });
    await answer("Folder", "~/projects/mobile");
    await answer("Name (optional)", "Mobile");
    await answer("Group (optional)", "");
    await screen.waitForFrame((f) => (f.split("\n")[0] ?? "").includes(" 1 Mobile "));

    await command("Rename Mobile");
    await answer("Name", "Mobile Banking");
    await screen.waitForFrame((f) => (f.split("\n")[0] ?? "").includes(" 1 Mobile Banking "));

    await command("Move Mobile Banking to a group");
    await answer("Group", "Client");
    await screen.waitForFrame((f) => !f.includes(" Move Mobile Banking to a group "));
    expect(JSON.parse((await run(["workspace", "list", "--json"])).stdout)).toMatchObject([
      { id: "mobile", name: "Mobile Banking", path: mobile, group: "Client" },
    ]);

    await command("Remove Mobile Banking");
    await screen.waitForFrame((f) => f.includes("Remove workspace?"));
    screen.mockInput.pressEnter();
    await screen.waitForFrame((f) => !(f.split("\n")[0] ?? "").includes("Mobile Banking"));
    expect(JSON.parse((await run(["workspace", "list", "--json"])).stdout)).toEqual([]);
    screen.mockInput.pressKey("q");
    expect((await running).code).toBe(EXIT.ok);
  });

  test("outside every workspace, the cockpit reopens the tabs left open", async () => {
    await run(["workspace", "add", mobile, "--name", "Mobile Banking"]);
    await run(["workspace", "add", join(projects, "api"), "--name", "Payments API"]);

    /** Opens the cockpit in `cwd`, returns its header with the tabs, then runs `steps` and quits. */
    const session = async (cwd: string, steps: (screen: TestRendererSetup) => Promise<void>) => {
      const terminal = headlessTerminal();
      const running = run([], {}, cwd, terminal.host);
      const screen = await terminal.screen;
      const frame = await screen.waitForFrame((f) => f.includes("血符"));
      await steps(screen);
      screen.mockInput.pressKey("q");
      expect((await running).code).toBe(EXIT.ok);
      // The tabs sit in the header, beside the mark.
      const [header = ""] = frame.split("\n");
      return { header, tabs: header, frame };
    };
    const open = async (screen: TestRendererSetup, query: string) => {
      screen.mockInput.pressKey("w", { ctrl: true });
      await screen.waitForFrame((f) => f.includes("2 of 2"));
      await screen.mockInput.typeText(query);
      screen.mockInput.pressEnter();
      await screen.waitForFrame((f) => !f.includes("Switch workspace"));
    };
    const idle = async () => undefined;

    expect((await session(projects, idle)).header).toContain("No workspace");
    await session(projects, async (screen) => {
      await open(screen, "pay");
      await open(screen, "mob");
    });
    const reopened = await session(projects, async (screen) => {
      screen.mockInput.pressKey("w", { meta: true });
      await screen.waitForFrame((f) => (f.split("\n")[0] ?? "").includes("Payments API"));
    });
    expect(reopened.header).toContain("Mobile Banking");
    expect(reopened.tabs).toContain(" 1 Payments API  2 Mobile Banking ");

    const afterClose = await session(projects, idle);
    expect(afterClose.header).toContain("Payments API");
    expect(afterClose.tabs).not.toContain("Mobile Banking");

    // Opening inside a workspace brings its tab back, on the section it was left on.
    await session(mobile, async (screen) => {
      screen.mockInput.pressKey("j");
      await screen.waitForFrame((f) => f.includes("─ Work ─"));
    });
    const back = await session(projects, idle);
    expect(back.header).toContain("Mobile Banking");
    expect(back.tabs).toContain(" 1 Payments API  2 Mobile Banking ");
    expect(back.frame).toContain("─ Work ─");

    const listed = JSON.parse((await run(["workspace", "list", "--json"])).stdout);
    expect(listed.map((w: { lastActiveAt: string | null }) => typeof w.lastActiveAt)).toEqual([
      "string",
      "string",
    ]);
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

  test("rename keeps the id", async () => {
    await run(["workspace", "add", mobile]);
    expect((await run(["workspace", "rename", "mobile", "Mobile Banking"])).stdout).toBe(
      "✓ mobile is now named Mobile Banking\n",
    );
    const missing = await run(["workspace", "rename", "ghost", "x"]);
    expect(missing.code).toBe(EXIT.noInput);
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

describe("runCli: timer", () => {
  let mobile: string;
  let api: string;
  beforeEach(async () => {
    const projects = join(realpathSync(dir.path), "projects");
    mobile = join(projects, "mobile");
    api = join(projects, "api");
    mkdirSync(mobile, { recursive: true });
    mkdirSync(api, { recursive: true });
    await run(["workspace", "add", mobile, "--name", "Mobile Banking"]);
    await run(["workspace", "add", api, "--name", "Payments API"]);
  });

  test("no timer: status exits 1, and pausing explains how to start one", async () => {
    expect(await run(["timer"])).toEqual({
      code: EXIT.none,
      stdout: "",
      stderr: "No timer is running.\n",
    });
    expect(await run(["timer", "status", "--json"])).toMatchObject({
      code: EXIT.none,
      stdout: "null\n",
    });
    const paused = await run(["timer", "pause"]);
    expect(paused.code).toBe(EXIT.noInput);
    expect(paused.stderr).toContain("No timer is running");
    expect(paused.stderr).toContain("xuefu timer start");
  });

  test("start times the workspace of the current folder, and survives a restart", async () => {
    expect(await run(["timer", "start", "--issue", "mob-2841"], {}, mobile)).toEqual({
      code: EXIT.ok,
      stdout: "✓ Started a timer for Mobile Banking (MOB-2841)\n",
      stderr: "",
    });
    const status = await run(["timer"]);
    expect(status.code).toBe(EXIT.ok);
    expect(status.stdout).toMatch(/^● Running {2}\d\d:\d\d:\d\d\n/);
    expect(status.stdout).toContain("Workspace    Mobile Banking (mobile-banking)");
    expect(status.stdout).toContain("Issue        MOB-2841");
    const json = JSON.parse((await run(["timer", "status", "--json"])).stdout);
    expect(json).toMatchObject({
      status: "running",
      workspaceId: "mobile-banking",
      workspaceName: "Mobile Banking",
      issueKey: "MOB-2841",
    });
    expect(json.elapsedMs).toBeGreaterThanOrEqual(0);
  });

  test("pause, resume and stop report the time tracked", async () => {
    await run(["timer", "start", "-w", "payments-api"]);
    expect((await run(["timer", "pause"])).stdout).toMatch(
      /^✓ Paused the timer for Payments API at \d\d:\d\d:\d\d\n$/,
    );
    expect((await run(["timer"])).stdout).toMatch(/^‖ Paused {3}\d\d:\d\d:\d\d\n/);
    expect((await run(["timer", "start", "-w", "payments-api"])).stdout).toMatch(
      /^✓ Resumed the timer for Payments API at /,
    );
    expect((await run(["timer", "resume"])).stderr).toContain("The timer is running, not paused");
    expect((await run(["timer", "stop"])).stdout).toMatch(
      /^✓ Stopped the timer for Payments API after \d\d:\d\d:\d\d\n$/,
    );
    expect((await run(["timer"])).code).toBe(EXIT.none);
  });

  test("starting in another workspace stops the running timer", async () => {
    await run(["timer", "start"], {}, mobile);
    const switched = await run(["timer", "start"], {}, api);
    expect(switched.stdout).toMatch(
      /^✓ Stopped the timer for Mobile Banking after \d\d:\d\d:\d\d\n✓ Started a timer for Payments API\n$/,
    );
    expect((await run(["timer", "start"], {}, api)).code).toBe(EXIT.data);
  });

  test("a timer outlives its removed workspace", async () => {
    await run(["timer", "start"], {}, mobile);
    await run(["workspace", "remove", "mobile-banking", "--yes"]);
    expect((await run(["timer"])).stdout).toContain("Workspace    mobile-banking (removed)");
    expect((await run(["timer", "stop"])).stdout).toContain(
      "Stopped the timer for mobile-banking after",
    );
  });

  test("the cockpit shows a running timer, and t and shift+t drive it", async () => {
    await run(["timer", "start"], {}, mobile);
    const terminal = headlessTerminal();
    const running = run([], {}, mobile, terminal.host);
    const screen = await terminal.screen;
    await screen.waitForFrame((f) => /● \d\d:\d\d:\d\d {2}│/.test(f));
    screen.mockInput.pressKey("t");
    await screen.waitForFrame((f) => /● \d\d:\d\d:\d\d paused/.test(f));
    await screen.mockInput.typeText("T");
    await screen.waitForFrame((f) => !/● \d\d:\d\d:\d\d/.test(f));
    screen.mockInput.pressKey("q");
    expect((await running).code).toBe(EXIT.ok);
    expect((await run(["timer"])).code).toBe(EXIT.none);
  });

  test("outside every workspace, start needs --workspace", async () => {
    const outside = await run(["timer", "start"]);
    expect(outside.code).toBe(EXIT.usage);
    expect(outside.stderr).toContain(`Not inside a workspace: ${dir.path}`);
    expect(outside.stderr).toContain("pass --workspace <id>");
    expect((await run(["timer", "start", "-w", "ghost"])).stderr).toContain("xuefu workspace list");
    expect((await run(["timer", "start"], {}, join(dir.path, "missing"))).code).toBe(EXIT.io);
  });
});

describe("runCli: work", () => {
  let mobile: string;
  let api: string;
  beforeEach(async () => {
    const projects = join(realpathSync(dir.path), "projects");
    mobile = join(projects, "mobile");
    api = join(projects, "api");
    mkdirSync(mobile, { recursive: true });
    mkdirSync(api, { recursive: true });
    await run(["workspace", "add", mobile, "--name", "Mobile Banking"]);
    await run(["workspace", "add", api, "--name", "Payments API"]);
  });

  test("nothing in progress: status exits 1 and finish explains how to start", async () => {
    expect(await run(["work"])).toEqual({
      code: EXIT.none,
      stdout: "",
      stderr: "No work in progress. Start with: xuefu work start <issue>\n",
    });
    expect(await run(["work", "--json"])).toMatchObject({ code: EXIT.none, stdout: "[]\n" });
    const finished = await run(["work", "finish"], {}, mobile);
    expect(finished.code).toBe(EXIT.noInput);
    expect(finished.stderr).toContain("No work in progress in Mobile Banking");
    expect(finished.stderr).toContain("xuefu work start <issue>");
  });

  test("start works on an issue here and times it; finish stops both", async () => {
    expect(
      await run(["work", "start", "mob-2841", "--title", "Add biometric login"], {}, mobile),
    ).toEqual({
      code: EXIT.ok,
      stdout:
        "✓ Working on MOB-2841 (Add biometric login) in Mobile Banking\n" +
        "✓ Started a timer for Mobile Banking (MOB-2841)\n",
      stderr: "",
    });
    const listed = await run(["work"]);
    expect(listed.stdout).toMatch(
      /^WORKSPACE {7}ISSUE {5}STARTED {11}TITLE\nMobile Banking {2}MOB-2841 {2}\w{3} \d\d \w{3} \d\d:\d\d {2}Add biometric login\n$/,
    );
    expect(JSON.parse((await run(["work", "--json"])).stdout)).toMatchObject([
      { workspaceId: "mobile-banking", workspaceName: "Mobile Banking", issueKey: "MOB-2841" },
    ]);
    expect((await run(["timer"])).stdout).toContain("Issue        MOB-2841");

    const finished = await run(["work", "finish"], {}, mobile);
    expect(finished.stdout).toMatch(
      /^✓ Finished MOB-2841 \(Add biometric login\) in Mobile Banking\n✓ Stopped the timer after \d\d:\d\d:\d\d\n$/,
    );
    expect((await run(["timer"])).code).toBe(EXIT.none);
  });

  test("a new issue finishes the old one; the timer follows the latest work", async () => {
    await run(["work", "start", "MOB-1"], {}, mobile);
    await run(["work", "start", "PAY-7", "-w", "payments-api"]);
    const switched = await run(["work", "start", "MOB-2"], {}, mobile);
    expect(switched.stdout).toMatch(
      /^✓ Finished MOB-1 in Mobile Banking\n✓ Working on MOB-2 in Mobile Banking\n✓ Stopped the timer for Payments API \(PAY-7\) after .+\n✓ Started a timer for Mobile Banking \(MOB-2\)\n$/,
    );
    expect((await run(["work"])).stdout).toContain("PAY-7");
    expect((await run(["work", "start", "MOB-2"], {}, mobile)).stderr).toContain(
      "Already working on MOB-2 in Mobile Banking",
    );
  });

  test("timer start without --issue times the work in progress", async () => {
    await run(["work", "start", "MOB-1"], {}, mobile);
    await run(["timer", "stop"]);
    expect((await run(["timer", "start"], {}, mobile)).stdout).toBe(
      "✓ Started a timer for Mobile Banking (MOB-1)\n",
    );
    const finished = await run(["work", "finish", "-w", "mobile-banking"]);
    expect(finished.stdout).toContain("✓ Stopped the timer after");
    await run(["work", "start", "MOB-3"], {}, mobile);
    await run(["timer", "stop"]);
    expect((await run(["work", "finish"], {}, mobile)).stdout).toBe(
      "✓ Finished MOB-3 in Mobile Banking\n",
    );
  });

  test("the cockpit palette starts and finishes work", async () => {
    const terminal = headlessTerminal();
    const running = run([], {}, mobile, terminal.host);
    const screen = await terminal.screen;
    await screen.waitForFrame((f) => f.includes("血符"));
    await screen.mockInput.typeText(":");
    await screen.waitForFrame((f) => f.includes(" Commands "));
    screen.mockInput.pressEnter();
    await screen.waitForFrame((f) => f.includes("Issue key"));
    await screen.mockInput.typeText("MOB-77");
    screen.mockInput.pressEnter();
    await screen.waitForFrame((f) => f.includes("Title (optional)"));
    screen.mockInput.pressEnter();
    // Starting work times it, so the timer shows in the header.
    await screen.waitForFrame((f) => /● \d\d:\d\d:\d\d/.test(f.split("\n")[0] ?? ""));
    expect((await run(["work"])).stdout).toContain("MOB-77");

    await screen.mockInput.typeText(":");
    await screen.waitForFrame((f) => f.includes("Finish work on MOB-77"));
    await screen.mockInput.typeText("finish");
    screen.mockInput.pressEnter();
    // Finishing stops its timer.
    await screen.waitForFrame((f) => !(f.split("\n")[0] ?? "").includes("●"));
    screen.mockInput.pressKey("q");
    expect((await running).code).toBe(EXIT.ok);
    expect((await run(["work"])).code).toBe(EXIT.none);
  });

  test("work outlives a removed workspace", async () => {
    await run(["work", "start", "MOB-1"], {}, mobile);
    await run(["workspace", "remove", "mobile-banking", "--yes"]);
    expect((await run(["work"])).stdout).toContain("mobile-banking (removed)");
    expect((await run(["work", "finish", "-w", "mobile-banking"])).stdout).toContain(
      "✓ Finished MOB-1 in mobile-banking",
    );
  });

  test("the cockpit catches up with work started from another terminal", async () => {
    const terminal = headlessTerminal();
    const running = run([], {}, mobile, terminal.host);
    const screen = await terminal.screen;
    await screen.waitForFrame((f) => f.includes("血符"));
    const header = () => screen.captureCharFrame().split("\n")[0] ?? "";
    expect(header()).not.toContain("●");

    await run(["work", "start", "MOB-5", "--title", "From the CLI"], {}, mobile);
    const deadline = Date.now() + 5_000;
    // Work started there is timed, so its timer shows up here.
    const caughtUp = () => /● \d\d:\d\d:\d\d/.test(header());
    while (!caughtUp() && Date.now() < deadline) {
      await Bun.sleep(50);
      await screen.renderOnce();
    }
    expect(caughtUp()).toBe(true);
    screen.mockInput.pressKey("q");
    expect((await running).code).toBe(EXIT.ok);
  });

  test("bad input and missing workspaces are reported", async () => {
    expect((await run(["work", "start", "nope"], {}, mobile)).code).toBe(EXIT.usage);
    expect((await run(["work", "start", "MOB-1"])).stderr).toContain("Not inside a workspace");
    expect((await run(["work", "finish"])).code).toBe(EXIT.usage);
  });
});

describe("runCli: timesheet", () => {
  const DAY = "2026-09-07";
  // Two workspaces in one group, and one in none.
  let mobile: string;
  let api: string;
  let web: string;
  beforeEach(async () => {
    const projects = realpathSync(dir.path);
    mobile = join(projects, "mobile");
    api = join(projects, "api");
    web = join(projects, "web");
    for (const folder of [mobile, api, web]) mkdirSync(folder);
    await run(["workspace", "add", mobile, "--name", "Mobile Banking"]);
    await run(["workspace", "add", api, "--name", "Payments API", "--group", "Payments"]);
    await run(["workspace", "add", web, "--name", "Payments Web", "--group", "Payments"]);
  });

  /** Adds time on DAY from `folder` and gives back its id. */
  async function add(folder: string, ...flags: string[]): Promise<string> {
    const added = await run(["timesheet", "add", "-d", DAY, ...flags], {}, folder);
    expect(added).toMatchObject({ code: EXIT.ok, stderr: "" });
    return /\((.+)\)\n$/.exec(added.stdout)?.[1] ?? "";
  }

  test("time is added, shown by day, week and month, changed and deleted", async () => {
    const added = await run(
      ["timesheet", "add", "-d", DAY, "--from", "09:00", "--to", "09:30", "-c", "Meeting"],
      {},
      mobile,
    );
    expect(added.stdout).toMatch(/^✓ Added 30m for Meeting \(.+\)\n$/);
    const id = await add(mobile, "--from", "23:00", "--to", "01:00", "--issue", "MOB-1");
    await run(["timesheet", "edit", id, "--note", "Fix"]);

    const day = await run(["timesheet", DAY], {}, mobile);
    expect(day.code).toBe(EXIT.ok);
    expect(day.stdout).toStartWith("Mobile Banking\n7 September 2026  1h 30m\n");
    expect(day.stdout).toMatch(/09:00-09:30 +30m +Meeting/);
    expect(day.stdout).toMatch(new RegExp(`23:00-24:00 +1h 00m +MOB-1 +Fix +${id}`));
    const next = await run(["timesheet", "day", "2026-09-08", "--json"], {}, mobile);
    expect(JSON.parse(next.stdout)).toMatchObject({
      timesheet: { kind: "workspace", workspaceId: "mobile-banking", name: "Mobile Banking" },
      day: "2026-09-08",
      spans: [{ id, kind: "entry", issueKey: "MOB-1", note: "Fix", durationMs: 2 * 3_600_000 }],
    });

    const week = await run(["timesheet", "week", DAY], {}, mobile);
    expect(week.stdout).toMatch(/^Mobile Banking\nDATE +TIME +NOTES\n7 September 2026 +1h 30m/);
    expect(week.stdout).toMatch(/13 September 2026 +-/);
    expect(week.stdout).toMatch(/Total +2h 30m/);
    const month = JSON.parse((await run(["timesheet", "month", "2026-09", "--json"])).stdout);
    expect(month).toHaveLength(30);

    expect(await run(["timesheet", "edit", id, "--to", "23:45", "--note", ""])).toMatchObject({
      code: EXIT.ok,
      stdout: `✓ Changed ${id}\n`,
    });
    expect((await run(["timesheet", DAY])).stdout).toMatch(/23:00-23:45 +45m +MOB-1 +\S+\n/);

    const asked = await run(["timesheet", "delete", id]);
    expect(asked.code).toBe(EXIT.usage);
    expect(asked.stderr).toContain("Re-run with --yes to confirm.");
    expect(await run(["timesheet", "delete", id, "-y"])).toMatchObject({
      code: EXIT.ok,
      stdout: `✓ Deleted ${id}\n`,
    });
    expect((await run(["timesheet", DAY])).stdout).toStartWith("7 September 2026  30m\n");
  });

  test("a group's timesheet adds up the time of its workspaces and of the group", async () => {
    // From a workspace in a group, added time is on the group unless a workspace is named.
    const meeting = await add(api, "--from", "09:00", "--to", "09:30", "-c", "Meeting");
    await add(web, "-w", "payments-web", "--from", "10:00", "--to", "11:00", "--issue", "PAY-1");
    await add(mobile, "--from", "12:00", "--to", "12:15", "-c", "Review");

    const payments = await run(["timesheet", DAY], {}, web);
    expect(payments.stdout).toStartWith("Payments\n7 September 2026  1h 30m\n");
    expect(payments.stdout).toMatch(new RegExp(`09:00-09:30 +30m +Meeting +${meeting}`));
    expect(payments.stdout).toMatch(/10:00-11:00 +1h 00m +PAY-1/);
    expect(payments.stdout).not.toContain("Review");
    expect((await run(["timesheet", DAY, "-g", "Payments"])).stdout).toBe(payments.stdout);
    expect((await run(["timesheet", DAY, "-w", "payments-api"])).stdout).toBe(payments.stdout);
    expect((await run(["timesheet", DAY, "-w", "mobile-banking"])).stdout).toStartWith(
      "Mobile Banking\n7 September 2026  15m\n",
    );
    // Outside every workspace, or with --all, every timesheet together.
    expect((await run(["timesheet", DAY])).stdout).toStartWith("7 September 2026  1h 45m\n");
    expect((await run(["timesheet", DAY, "--all"], {}, web)).stdout).toStartWith(
      "7 September 2026  1h 45m\n",
    );
    const json = JSON.parse(
      (await run(["timesheet", "day", DAY, "-g", "Payments", "--json"])).stdout,
    );
    expect(json).toMatchObject({
      timesheet: { kind: "group", group: "Payments", workspaceId: null, name: "Payments" },
      spans: [
        { id: meeting, workspaceId: null, group: "Payments", category: "Meeting" },
        { workspaceId: "payments-web", workspaceName: "Payments Web", group: "Payments" },
      ],
    });

    // A day is set on the group's timesheet from any of its workspaces.
    expect(await run(["timesheet", "day", DAY, "--leave"], {}, api)).toMatchObject({
      code: EXIT.ok,
    });
    expect((await run(["timesheet", DAY, "-g", "Payments"])).stdout).toContain("\n  Leave\n");
    expect((await run(["timesheet", DAY], {}, mobile)).stdout).not.toContain("Leave");
    expect((await run(["timesheet", "week", DAY, "--all"])).stdout).not.toContain("Leave");
  });

  test("a timesheet must be one that exists, and a day is set on one", async () => {
    const ghosts = await run(["timesheet", "-g", "Ghosts"]);
    expect(ghosts.code).toBe(EXIT.noInput);
    expect(ghosts.stderr).toContain("No group named Ghosts");
    expect((await run(["timesheet", "-w", "ghost"])).code).toBe(EXIT.noInput);
    expect((await run(["timesheet", "-w", "Bad Id"])).code).toBe(EXIT.usage);
    expect((await run(["timesheet", "-g", "a\tb"])).code).toBe(EXIT.usage);
    expect((await run(["timesheet", "--all", "-g", "Payments"])).stderr).toContain(
      "--all is every timesheet",
    );
    expect((await run(["timesheet", "day", DAY, "--leave", "--all"])).stderr).toContain(
      "--all is only for showing",
    );
    const outside = await run(["timesheet", "day", DAY, "--leave"]);
    expect(outside.code).toBe(EXIT.usage);
    expect(outside.stderr).toContain("Not inside a workspace");
    expect(
      (await run(["timesheet", "day", DAY, "--leave", "-g", "Payments", "-w", "mobile-banking"]))
        .code,
    ).toBe(EXIT.usage);
    expect((await run(["timesheet", "day", DAY, "--leave", "-g", "Ghosts"])).code).toBe(
      EXIT.noInput,
    );
    expect(
      (
        await run([
          "timesheet",
          "add",
          "-g",
          "Ghosts",
          "-c",
          "Meeting",
          "--from",
          "09:00",
          "--to",
          "10:00",
        ])
      ).code,
    ).toBe(EXIT.noInput);
  });

  test("a day's place, leave and tasks are set and shown", async () => {
    expect(
      await run(
        ["timesheet", "day", DAY, "--place", "Office", "--tasks", "Login: fixed."],
        {},
        mobile,
      ),
    ).toMatchObject({ code: EXIT.ok, stdout: `✓ Changed ${DAY}\n` });
    await run(["timesheet", "day", DAY, "--leave", "-w", "mobile-banking"]);
    expect((await run(["timesheet", DAY], {}, mobile)).stdout).toBe(
      "Mobile Banking\n7 September 2026  0m\n  Leave\n  At Office\n  Tasks: Login: fixed.\n  Nothing tracked.\n",
    );
    expect((await run(["timesheet", "day", "--worked"], {}, mobile)).code).toBe(EXIT.ok);
  });

  test("a timer's stretch is moved, and only its time can change", async () => {
    await run(["timer", "start"], {}, mobile);
    await run(["timer", "stop"]);
    const today = JSON.parse((await run(["timesheet", "--json"])).stdout);
    const stretch: string = today.spans[0].id;
    expect(stretch).toMatch(/:0$/);

    expect(
      await run(["timesheet", "edit", stretch, "-d", DAY, "--from", "08:00", "--to", "08:30"]),
    ).toMatchObject({ code: EXIT.ok, stdout: `✓ Changed ${stretch}\n` });
    expect((await run(["timesheet", DAY])).stdout).toMatch(
      new RegExp(`08:00-08:30 +30m +Mobile Banking +timed +${stretch}`),
    );
    expect(await run(["timesheet", "edit", stretch, "-d", DAY, "--to", "08:15"])).toMatchObject({
      code: EXIT.ok,
    });
    expect((await run(["timesheet", DAY])).stdout).toMatch(/08:00-08:15 +15m/);

    const refused = await run(["timesheet", "edit", stretch, "--note", "x"]);
    expect(refused.code).toBe(EXIT.usage);
    expect(refused.stderr).toContain("Only a timer's time can change");
    const [timer] = stretch.split(":");
    expect((await run(["timesheet", "edit", `${timer}:4`, "--from", "08:00"])).code).toBe(
      EXIT.noInput,
    );
  });

  test("bad input and unknown time are reported", async () => {
    const missing = await run(["timesheet", "add", "-c", "Meeting"], {}, mobile);
    expect(missing.code).toBe(EXIT.usage);
    expect(missing.stderr).toContain("When is missing");
    const late = await run(["timesheet", "add", "--from", "25:00", "--to", "26:00"], {}, mobile);
    expect(late.stderr).toContain("--from is not a time of day");
    expect(
      (await run(["timesheet", "add", "--from", "09:00", "--to", "nine"], {}, mobile)).stderr,
    ).toContain("--to is not a time of day");
    expect(
      (await run(["timesheet", "add", "-d", "2026-02-30", "--from", "09:00", "--to", "10:00"]))
        .code,
    ).toBe(EXIT.usage);
    expect(
      (await run(["timesheet", "add", "--from", "09:00", "--to", "10:00", "-c", "Meeting"])).stderr,
    ).toContain("Not inside a workspace");
    expect(
      (await run(["timesheet", "add", "--from", "09:00", "--to", "10:00"], {}, mobile)).code,
    ).toBe(EXIT.usage);
    expect((await run(["timesheet", "2026-13-01"])).code).toBe(EXIT.usage);
    expect((await run(["timesheet", "week", "nope"])).code).toBe(EXIT.usage);
    expect((await run(["timesheet", "month", "2026-9"])).code).toBe(EXIT.usage);
    expect((await run(["timesheet", "day", "nope", "--leave"])).code).toBe(EXIT.usage);
    expect((await run(["timesheet", "day", DAY, "--place", "a\u0007"], {}, mobile)).code).toBe(
      EXIT.usage,
    );
    expect((await run(["timesheet", "edit", "ent 1", "--from", "08:00"])).code).toBe(EXIT.usage);
    expect((await run(["timesheet", "edit", "ghost", "--from", "08:00"])).code).toBe(EXIT.noInput);
    expect((await run(["timesheet", "edit", "ghost", "--from", "8"])).code).toBe(EXIT.usage);
    expect((await run(["timesheet", "edit", " :0", "--from", "08:00"])).code).toBe(EXIT.usage);
    expect((await run(["timesheet", "edit", "ghost:0", "--from", "08:00"])).code).toBe(
      EXIT.noInput,
    );
    expect((await run(["timesheet", "delete", "ghost", "-y"])).code).toBe(EXIT.noInput);
    expect((await run(["timesheet", "month"])).code).toBe(EXIT.ok);
  });
});

describe("runCli: activity", () => {
  const line = (text: string) => new RegExp(`^ {2}\\d\\d:\\d\\d {2}${text}$`);

  test("with nothing recorded it says so", async () => {
    expect(await run(["activity"])).toEqual({
      code: EXIT.none,
      stdout: "",
      stderr: "Nothing recorded yet.\n",
    });
    expect(await run(["activity", "-w", "ghost", "--json"])).toMatchObject({
      code: EXIT.none,
      stdout: "[]\n",
    });
  });

  test("shows what happened, newest first, grouped by day", async () => {
    const mobile = join(realpathSync(dir.path), "mobile");
    mkdirSync(mobile);
    await run(["workspace", "add", mobile, "--name", "Mobile Banking"]);
    await run(["work", "start", "MOB-2841", "--title", "Add biometric login"], {}, mobile);
    await run(["timer", "pause"]);
    await run(["work", "finish"], {}, mobile);

    const shown = await run(["activity"]);
    expect(shown.code).toBe(EXIT.ok);
    const [day, ...lines] = shown.stdout.trimEnd().split("\n");
    expect(day).toMatch(/^\w{3} \d\d \w{3}$/);
    const expected = [
      line("Mobile Banking {2}Stopped the timer {2}\\d\\d:\\d\\d:\\d\\d"),
      line("Mobile Banking {2}Finished work on MOB-2841"),
      line("Mobile Banking {2}Paused the timer {2}\\d\\d:\\d\\d:\\d\\d"),
      line("Mobile Banking {2}Started the timer for MOB-2841"),
      line("Mobile Banking {2}Started work on MOB-2841 {2}Add biometric login"),
      line(`Mobile Banking {2}Added {2}${mobile.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`),
    ];
    expect(lines).toHaveLength(expected.length);
    lines.forEach((text, i) => {
      expect(text).toMatch(expected[i] ?? /never/);
    });

    expect(JSON.parse((await run(["activity", "--json", "-n", "1"])).stdout)).toEqual([
      {
        seq: 6,
        at: expect.stringMatching(/^\d{4}-\d\d-\d\dT/),
        workspaceId: "mobile-banking",
        workspaceName: "Mobile Banking",
        action: "Stopped the timer",
        subject: null,
        detail: expect.stringMatching(/^\d\d:\d\d:\d\d$/),
      },
    ]);
  });

  test("--limit caps the entries and says when older ones are left out", async () => {
    for (const name of ["one", "two", "three"]) {
      const path = join(realpathSync(dir.path), name);
      mkdirSync(path);
      await run(["workspace", "add", path]);
    }
    const capped = await run(["activity", "-n", "2"]);
    expect(capped.stdout.trimEnd().split("\n")).toHaveLength(3);
    expect(capped.stdout).toContain("three");
    expect(capped.stdout).not.toContain("one");
    expect(capped.stderr).toBe("Older entries not shown; raise --limit to see them.\n");
    expect((await run(["activity", "-n", "3"])).stderr).toBe("");

    const one = await run(["activity", "-w", "one"]);
    expect(one.stdout).toContain("one  Added");
    expect(one.stdout).not.toContain("two");
  });

  test("the cockpit's Activity section follows what is done there", async () => {
    const mobile = join(realpathSync(dir.path), "mobile");
    mkdirSync(mobile);
    await run(["workspace", "add", mobile, "--name", "Mobile Banking"]);
    const terminal = headlessTerminal();
    const running = run([], {}, mobile, terminal.host);
    const screen = await terminal.screen;
    await screen.waitForFrame((f) => f.includes("血符"));
    screen.mockInput.pressKey("k");
    screen.mockInput.pressKey("k");
    // Opening it is not activity; adding it is.
    const shown = await screen.waitForFrame(
      (f) => f.includes("─ Activity ─") && f.includes("Added"),
    );
    expect(shown).not.toContain("Opened");
    screen.mockInput.pressKey("t");
    await screen.waitForFrame((f) => f.includes("Started the timer"));
    screen.mockInput.pressKey("q");
    expect((await running).code).toBe(EXIT.ok);
  });

  test("a bad limit or workspace id is a usage error", async () => {
    for (const limit of ["0", "1001", "2.5", "lots"]) {
      const refused = await run(["activity", "-n", limit]);
      expect(refused.code).toBe(EXIT.usage);
      expect(refused.stderr).toContain("Limit must be a whole number from 1 to 1000");
    }
    expect((await run(["activity", "-w", "Not An Id"])).code).toBe(EXIT.usage);
  });
});

describe("runCli: notes", () => {
  let mobile: string;
  beforeEach(async () => {
    mobile = join(realpathSync(dir.path), "mobile");
    mkdirSync(mobile);
    await run(["workspace", "add", mobile, "--name", "Mobile Banking"]);
  });
  const note = (argv: string[], stdin: string | null = null) =>
    run(["note", ...argv], {}, mobile, NO_TERMINAL, stdin);

  test("with no note, show says how to start one", async () => {
    expect(await note([])).toEqual({
      code: EXIT.none,
      stdout: "",
      stderr: "No note for Mobile Banking yet. Start one with: xuefu note append <text>\n",
    });
    expect(await note(["--json"])).toMatchObject({ code: EXIT.none, stdout: "null\n" });
    expect((await note(["list"])).stderr).toBe(
      "No notes yet. Start one with: xuefu note append <text>\n",
    );
  });

  test("save takes the text piped in; show prints it back", async () => {
    expect(await note(["save"], "Staging needs the VPN\r\nAsk Dana for access\n")).toEqual({
      code: EXIT.ok,
      stdout: "✓ Saved the note for Mobile Banking\n",
      stderr: "",
    });
    expect((await note([])).stdout).toBe("Staging needs the VPN\nAsk Dana for access\n");
    expect((await note(["save"], "Staging needs the VPN\nAsk Dana for access")).stdout).toBe(
      "✓ The note for Mobile Banking already says that\n",
    );
    expect(JSON.parse((await note(["show", "--json"])).stdout)).toMatchObject({
      workspaceId: "mobile-banking",
      issueKey: null,
      body: "Staging needs the VPN\nAsk Dana for access",
      updatedAt: expect.stringMatching(/^\d{4}-/),
    });
  });

  test("append and clear an issue's note, apart from the workspace's", async () => {
    await note(["append", "Ask", "QA", "--issue", "mob-1"]);
    expect((await note(["append", "Then rebase", "--issue", "MOB-1"])).stdout).toBe(
      "✓ Added to the note on MOB-1 in Mobile Banking\n",
    );
    expect((await note(["--issue", "MOB-1"])).stdout).toBe("Ask QA\nThen rebase\n");
    expect((await note([])).code).toBe(EXIT.none);
    expect((await note(["clear", "--issue", "MOB-1"])).stdout).toBe(
      "✓ Cleared the note on MOB-1 in Mobile Banking\n",
    );
    expect(await note(["clear", "--issue", "MOB-1"])).toMatchObject({
      code: EXIT.none,
      stderr: "No note on MOB-1 in Mobile Banking to clear.\n",
    });
  });

  test("text that looks secret is saved with a warning, and shown masked", async () => {
    const saved = await note(["append", "staging password=hunter2"]);
    expect(saved.code).toBe(EXIT.ok);
    expect(saved.stderr).toContain("looks like it holds a secret");
    expect((await note([])).stdout).toBe("staging password=[REDACTED]\n");
  });

  test("list shows every note with its first line", async () => {
    await note(["append", "Staging needs the VPN"]);
    await note(["append", "Ask QA", "--issue", "MOB-1"]);
    const listed = await note(["list"]);
    expect(listed.stdout).toMatch(/^WORKSPACE {7}ISSUE {2}UPDATED {11}NOTE\n/);
    expect(listed.stdout).toContain("MOB-1  ");
    expect(listed.stdout).toContain("Staging needs the VPN");
    expect(JSON.parse((await note(["list", "--json"])).stdout)).toHaveLength(2);
  });

  test("the cockpit's Notes section shows notes masked, and follows the CLI", async () => {
    await note(["append", "Staging password=hunter2"]);
    const terminal = headlessTerminal();
    const running = run([], {}, mobile, terminal.host);
    const screen = await terminal.screen;
    await screen.waitForFrame((f) => f.includes("血符"));
    screen.mockInput.pressKey("k");
    await screen.waitForFrame((f) => f.includes("─ Notes ─") && f.includes("password=[REDACTED]"));
    expect(screen.captureCharFrame()).not.toContain("hunter2");

    await note(["append", "Ask Dana for VPN access"]);
    const deadline = Date.now() + 5_000;
    while (!screen.captureCharFrame().includes("Ask Dana") && Date.now() < deadline) {
      await Bun.sleep(50);
      await screen.renderOnce();
    }
    expect(screen.captureCharFrame()).toContain("Ask Dana for VPN access");
    screen.mockInput.pressKey("q");
    expect((await running).code).toBe(EXIT.ok);
  });

  test("save needs text piped in; bad input and places are reported", async () => {
    const unpiped = await note(["save"]);
    expect(unpiped.code).toBe(EXIT.usage);
    expect(unpiped.stderr).toContain("Pipe the note's text in");
    expect((await note(["append", "x", "--issue", "nope"])).code).toBe(EXIT.usage);
    expect((await run(["note", "append", "x"])).stderr).toContain("Not inside a workspace");
    expect((await note(["-w", "ghost"])).code).toBe(EXIT.noInput);
  });
});

describe("runCli: plugins", () => {
  const config = (yaml: string) => {
    mkdirSync(join(dir.path, "config"), { recursive: true });
    writeFileSync(join(dir.path, "config", "config.yml"), `version: 1\n${yaml}`);
  };

  test("git status shows the repository of the workspace this folder is in", async () => {
    const repo = makeRepo();
    try {
      await run(["workspace", "add", repo.path, "--name", "Mobile"], GIT_ENV);
      repo.write("README.md", "changed\n");
      repo.write("new.txt", "new\n");
      const shown = await run(["git"], GIT_ENV, repo.path);
      expect(shown).toEqual({
        code: EXIT.ok,
        stdout:
          "On main, not tracking a remote branch\n" +
          "Not staged:\n  M  README.md\nUntracked:\n  ?  new.txt\n",
        stderr: "",
      });

      repo.git("add", ".");
      repo.git("commit", "-q", "-m", "second");
      const clean = await run(["git", "status", "-w", "mobile"], GIT_ENV);
      expect(clean.stdout).toBe(
        "On main, not tracking a remote branch\nNothing to commit, working tree clean.\n",
      );

      const json = JSON.parse((await run(["git", "--json", "-w", "mobile"], GIT_ENV)).stdout);
      expect(json).toMatchObject({ workspace: "mobile", repository: true, branch: "main" });
    } finally {
      repo.cleanup();
    }
  });

  test("a workspace that is not a repository exits 1 and says so", async () => {
    const plain = join(dir.path, "plain");
    mkdirSync(plain);
    await run(["workspace", "add", plain], GIT_ENV);
    const shown = await run(["git", "status", "-w", "plain"], GIT_ENV);
    expect(shown.code).toBe(EXIT.none);
    expect(shown.stderr).toBe(`plain is not a git repository: ${realpathSync(plain)}\n`);
    const json = await run(["git", "--json", "-w", "plain"], GIT_ENV);
    expect(JSON.parse(json.stdout)).toEqual({ workspace: "plain", repository: false });
  });

  test("outside every workspace it asks for one", async () => {
    const shown = await run(["git"], GIT_ENV);
    expect(shown.code).toBe(EXIT.usage);
    expect(shown.stderr).toContain("Not inside a workspace");
  });

  test("a plugin turned off in config says how to turn it back on", async () => {
    config("plugins:\n  git:\n    enabled: false\n");
    const shown = await run(["git"], GIT_ENV);
    expect(shown.code).toBe(EXIT.config);
    expect(shown.stderr).toContain("The Git plugin is turned off");
    expect(shown.stderr).toContain("plugins.git.enabled");
  });

  test("a plugin that needs setting up says what to set", async () => {
    const shown = await run(["jira"]);
    expect(shown.code).toBe(EXIT.config);
    expect(shown.stderr).toContain("The Jira plugin is not set up");
    expect(shown.stderr).toContain("plugins.jira.url");
  });

  test("the pull requests plugin, too, says what to set", async () => {
    const shown = await run(["pr"]);
    expect(shown.code).toBe(EXIT.config);
    expect(shown.stderr).toContain("The pull requests plugin is not set up");
    expect(shown.stderr).toContain("plugins.pr.url");
  });

  test("settings for an unknown plugin, or invalid ones, stop XueFu from starting", async () => {
    config("plugins:\n  gti:\n    enabled: true\n");
    const typo = await run(["diagnostics"]);
    expect(typo.code).toBe(EXIT.config);
    expect(typo.stderr).toContain('no plugin named "gti"; plugins: git, jira, pr');

    config("plugins:\n  git:\n    enabled: sometimes\n");
    const invalid = await run(["diagnostics"]);
    expect(invalid.code).toBe(EXIT.config);
    expect(invalid.stderr).toContain("Invalid settings for the Git plugin");
    expect(invalid.stderr).toContain("plugins.git.enabled");
  });

  test("help lists plugins' commands", async () => {
    expect((await run(["--help"])).stdout).toContain("git [status]");
  });
});

describe("runCli: agents over MCP", () => {
  /** Serves the messages as an agent's harness would send them; the replies come back by id. */
  async function mcp(messages: object[], env: Record<string, string> = {}, cwd = dir.path) {
    const input = messages.map((message) => `${JSON.stringify({ jsonrpc: "2.0", ...message })}\n`);
    const served = await run(["mcp"], env, cwd, NO_TERMINAL, input.join(""));
    expect(served.code).toBe(EXIT.ok);
    expect(served.stderr).toBe("");
    const replies = served.stdout
      .trimEnd()
      .split("\n")
      .map((line) => JSON.parse(line));
    return new Map(replies.map((reply) => [reply.id, reply]));
  }
  const call = (id: number, name: string, args: object = {}) => ({
    id,
    method: "tools/call",
    params: { name, arguments: args },
  });
  const text = (reply: { result: { content: { text: string }[] } }) =>
    reply.result.content.map((part) => part.text).join("");

  test("lists the core's tools and those of the plugins that are on", async () => {
    const replies = await mcp([{ id: 1, method: "tools/list" }]);
    const names = replies.get(1).result.tools.map((tool: { name: string }) => tool.name);
    expect(names).toContain("work_start");
    expect(names).toContain("git_status");
    // Jira and Bitbucket are not set up here.
    expect(names.some((name: string) => /^(jira|pr)_/.test(name))).toBe(false);
  });

  test("tools run XueFu's commands in the folder the agent runs in", async () => {
    const repo = makeRepo();
    try {
      await run(["workspace", "add", repo.path, "--name", "Mobile"], GIT_ENV);
      const started = await mcp(
        [call(1, "work_start", { issue: "MOB-1", title: "Biometric login" })],
        GIT_ENV,
        repo.path,
      );
      expect(started.get(1).result.isError).toBe(false);
      expect(text(started.get(1))).toContain("MOB-1");

      const replies = await mcp(
        [call(2, "work_status"), call(3, "git_status"), call(4, "work_start")],
        GIT_ENV,
        repo.path,
      );
      expect(JSON.parse(text(replies.get(2)))).toMatchObject([
        { workspaceId: "mobile", issueKey: "MOB-1", title: "Biometric login" },
      ]);
      expect(JSON.parse(text(replies.get(3)))).toMatchObject({ workspace: "mobile" });
      expect(replies.get(4).result).toEqual({
        content: [{ type: "text", text: "Missing argument: issue" }],
        isError: true,
      });
    } finally {
      repo.cleanup();
    }
  });

  test("a change asks first; the agent confirms it only by calling again with yes", async () => {
    const fixture = readFileSync(
      join(import.meta.dir, "..", "..", "contract", "pr", "fixtures", "pull-request.json"),
      "utf8",
    );
    const sent: string[] = [];
    const pull = "/rest/api/1.0/projects/MOB/repos/mobile-banking/pull-requests/42";
    const bitbucket = Bun.serve({
      port: 0,
      fetch: (request) => {
        const path = new URL(request.url).pathname;
        sent.push(`${request.method} ${path}`);
        if (path === pull) return new Response(fixture);
        if (path === "/rest/api/1.0/application-properties") {
          return Response.json({}, { headers: { "X-AUSERNAME": "dscully" } });
        }
        if (path === "/rest/api/1.0/users") {
          return Response.json({ values: [{ name: "dscully", slug: "dscully" }] });
        }
        return Response.json({ status: "APPROVED" });
      },
    });
    try {
      mkdirSync(join(dir.path, "config"), { recursive: true });
      writeFileSync(
        join(dir.path, "config", "config.yml"),
        `version: 1\nplugins:\n  pr:\n    url: http://127.0.0.1:${bitbucket.port}\n` +
          "    token: { env: BITBUCKET_TOKEN }\n",
      );
      const env = { BITBUCKET_TOKEN: "BBDC-agent-test-token" };
      const target = { pullRequest: "MOB/mobile-banking#42" };

      const asked = (await mcp([call(1, "pr_approve", target)], env)).get(1);
      expect(asked.result.isError).toBe(true);
      expect(text(asked)).toContain("? Approve MOB/mobile-banking#42");
      expect(text(asked)).toContain("call the tool again with yes set to true");
      expect(sent).toEqual([`GET ${pull}`]);

      const approved = (await mcp([call(2, "pr_approve", { ...target, yes: true })], env)).get(2);
      expect(approved.result.isError).toBe(false);
      expect(text(approved)).toContain("✓ Approved MOB/mobile-banking#42");
      expect(sent.at(-1)).toBe(`PUT ${pull}/participants/dscully`);
    } finally {
      bitbucket.stop(true);
    }
  });

  test("started from a terminal, it says what it is for", async () => {
    let stderr = "";
    const code = await runCli({
      argv: ["mcp"],
      env: { XUEFU_CONFIG_DIR: join(dir.path, "config"), XUEFU_DATA_DIR: join(dir.path, "data") },
      home: dir.path,
      cwd: dir.path,
      version: "9.9.9",
      tui: NO_TERMINAL,
      stdin: { piped: false, read: () => Promise.resolve(""), chunks: () => [] },
      stdout: { write: () => undefined },
      stderr: { write: (s) => (stderr += s) },
    });
    expect(code).toBe(EXIT.ok);
    expect(stderr).toContain("claude mcp add xuefu -- xuefu mcp");
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
    [errors.processError("p", "git", 128), EXIT.unavailable],
    [errors.remoteError("r", "jira.example.com", null), EXIT.unavailable],
    [errors.remoteError("r", "jira.example.com", 503), EXIT.unavailable],
    [errors.remoteError("r", "jira.example.com", 401), EXIT.noPermission],
    [errors.remoteError("r", "jira.example.com", 403), EXIT.noPermission],
    [errors.cancelled("c"), EXIT.cancelled],
    [errors.commandNotFound("x.y"), EXIT.software],
    [errors.duplicateCommand("x.y"), EXIT.software],
    [errors.unexpected("u", new Error("boom")), EXIT.software],
  ] as [AppError, number][])("%#: %o exits %i", (error, code) => {
    expect(exitCodeFor(error)).toBe(code);
  });
});
