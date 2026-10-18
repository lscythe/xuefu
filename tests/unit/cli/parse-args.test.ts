import { describe, expect, test } from "bun:test";
import { type CliCommand, type CliInvocation, parseArgs } from "../../../src/cli/parse-args";
import type { PluginCommandSpec } from "../../../src/cli/plugin-command";

const run = (command: CliCommand, overrides: Record<string, unknown> = {}): CliInvocation => ({
  kind: "run",
  command,
  overrides,
});

describe("parseArgs", () => {
  test.each([
    [[], run({ kind: "cockpit" })],
    [["--debug"], run({ kind: "cockpit" }, { logging: { level: "debug" } })],
    [["--help"], { kind: "help" }],
    [["-h"], { kind: "help" }],
    [["workspace", "add", "--help"], { kind: "help" }],
    [["--version"], { kind: "version" }],
    [["-v"], { kind: "version" }],
    [["diagnostics"], run({ kind: "diagnostics", json: false })],
    [["diagnostics", "--json"], run({ kind: "diagnostics", json: true })],
    [
      ["--debug", "diagnostics"],
      run({ kind: "diagnostics", json: false }, { logging: { level: "debug" } }),
    ],
    [
      ["diagnostics", "--log-level", "warn"],
      run({ kind: "diagnostics", json: false }, { logging: { level: "warn" } }),
    ],
  ] as const)("%p", (argv, expected) => {
    expect(parseArgs([...argv])).toEqual({ ok: true, value: expected });
  });

  test("--log-level wins over --debug when both are given", () => {
    const result = parseArgs(["--debug", "--log-level", "trace", "diagnostics"]);
    expect(result.ok && result.value).toMatchObject({ overrides: { logging: { level: "trace" } } });
  });

  test("leaves log-level validation to the configuration layer", () => {
    const result = parseArgs(["diagnostics", "--log-level", "loud"]);
    expect(result.ok && result.value).toMatchObject({ overrides: { logging: { level: "loud" } } });
  });

  test.each([
    [["--nope"], "--nope"],
    [["frobnicate"], "frobnicate"],
    [["constructor"], "constructor"],
    [["workspace list"], "workspace list"],
    [["diagnostics", "extra"], "extra"],
    [["--log-level"], "--log-level"],
  ])("rejects %p with a usage error mentioning %p", (argv, mention) => {
    const result = parseArgs(argv);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("validation");
      expect(JSON.stringify(result.error)).toContain(mention);
    }
  });
});

describe("parseArgs: workspace", () => {
  test.each([
    [["workspace"], { kind: "workspace.list", json: false }],
    [["workspace", "list", "--json"], { kind: "workspace.list", json: true }],
    [
      ["workspace", "add"],
      { kind: "workspace.add", path: null, name: null, id: null, group: null },
    ],
    [
      [
        "workspace",
        "add",
        "../mobile",
        "--name",
        "Mobile Banking",
        "--id",
        "mob",
        "--group",
        "Client",
      ],
      {
        kind: "workspace.add",
        path: "../mobile",
        name: "Mobile Banking",
        id: "mob",
        group: "Client",
      },
    ],
    [["workspace", "remove", "mob"], { kind: "workspace.remove", id: "mob", yes: false }],
    [["workspace", "remove", "mob", "-y"], { kind: "workspace.remove", id: "mob", yes: true }],
    [
      ["workspace", "group", "mob", "Client A"],
      { kind: "workspace.group", id: "mob", group: "Client A" },
    ],
    [["workspace", "ungroup", "mob"], { kind: "workspace.group", id: "mob", group: null }],
    [
      ["workspace", "rename", "mob", "Mobile"],
      { kind: "workspace.rename", id: "mob", name: "Mobile" },
    ],
    [["workspace", "which"], { kind: "workspace.which", path: null, json: false }],
    [
      ["workspace", "which", "/tmp", "--json"],
      { kind: "workspace.which", path: "/tmp", json: true },
    ],
  ] as const)("%p", (argv, command) => {
    expect(parseArgs([...argv])).toEqual({ ok: true, value: run(command) });
  });

  test.each([
    [["workspace", "launch"], "Unknown workspace command: launch"],
    [["workspace", "remove"], "workspace remove expects <id>"],
    [["workspace", "group", "mob"], "workspace group expects <id> <group>"],
    [["workspace", "rename", "mob"], "workspace rename expects <id> <name>"],
    [["workspace", "add", "a", "b"], "workspace add expects [path]"],
    [["workspace", "list", "--yes"], "--yes does not apply to workspace list"],
    [["diagnostics", "--name", "x"], "--name does not apply to diagnostics"],
    [["--json"], "--json does not apply to xuefu"],
  ])("rejects %p", (argv, message) => {
    const result = parseArgs(argv);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toBe(message);
  });
});

describe("parseArgs: timer", () => {
  test.each([
    [["timer"], { kind: "timer.status", json: false }],
    [["timer", "status", "--json"], { kind: "timer.status", json: true }],
    [["timer", "start"], { kind: "timer.start", workspace: null, issue: null }],
    [
      ["timer", "start", "-w", "mob", "--issue", "MOB-2841"],
      { kind: "timer.start", workspace: "mob", issue: "MOB-2841" },
    ],
    [["timer", "pause"], { kind: "timer.change", action: "pause" }],
    [["timer", "resume"], { kind: "timer.change", action: "resume" }],
    [["timer", "stop"], { kind: "timer.change", action: "stop" }],
  ] as const)("%p", (argv, command) => {
    expect(parseArgs([...argv])).toEqual({ ok: true, value: run(command) });
  });

  test.each([
    [["timer", "reset"], "Unknown timer command: reset"],
    [["timer", "start", "MOB-1"], "Unexpected argument: MOB-1"],
    [["timer", "stop", "--issue", "MOB-1"], "--issue does not apply to timer stop"],
    [["timer", "status", "--workspace", "mob"], "--workspace does not apply to timer status"],
  ])("rejects %p", (argv, message) => {
    expect(parseArgs(argv)).toMatchObject({ ok: false, error: { message } });
  });
});

describe("parseArgs: timesheet", () => {
  const noFields = {
    workspace: null,
    group: null,
    issue: null,
    category: null,
    from: null,
    to: null,
    date: null,
    note: null,
  };
  const here = { workspace: null, group: null, all: false };
  const show = (span: string, when: string | null, extra: object = {}) => ({
    kind: "timesheet.show",
    span,
    when,
    target: here,
    json: false,
    ...extra,
  });
  const day = (fields: object) => ({
    kind: "timesheet.day",
    target: here,
    day: null,
    place: null,
    leave: null,
    tasks: null,
    ...fields,
  });

  test.each([
    [["timesheet"], show("day", null)],
    [["timesheet", "2026-10-16"], show("day", "2026-10-16")],
    [["timesheet", "day", "2026-10-16", "--json"], show("day", "2026-10-16", { json: true })],
    [["timesheet", "week"], show("week", null)],
    [["timesheet", "month", "2026-09"], show("month", "2026-09")],
    [
      ["timesheet", "month", "-g", "Banking"],
      show("month", null, { target: { ...here, group: "Banking" } }),
    ],
    [["timesheet", "week", "--all"], show("week", null, { target: { ...here, all: true } })],
    [
      ["timesheet", "day", "-w", "mob", "--json"],
      show("day", null, { target: { ...here, workspace: "mob" }, json: true }),
    ],
    [
      ["timesheet", "day", "--place", "Office", "--tasks", "Login: fixed."],
      day({ place: "Office", tasks: "Login: fixed." }),
    ],
    [["timesheet", "day", "2026-10-16", "--leave"], day({ day: "2026-10-16", leave: true })],
    [
      ["timesheet", "day", "--worked", "--group", "Banking"],
      day({ leave: false, target: { ...here, group: "Banking" } }),
    ],
    [["timesheet", "add"], { kind: "timesheet.add", fields: noFields }],
    [
      ["timesheet", "add", "-g", "Banking"],
      { kind: "timesheet.add", fields: { ...noFields, group: "Banking" } },
    ],
    [
      [
        "timesheet",
        "add",
        "-w",
        "mob",
        "-c",
        "Meeting",
        "--from",
        "13:00",
        "--to",
        "13:30",
        "-d",
        "2026-10-16",
        "--note",
        "Planning",
      ],
      {
        kind: "timesheet.add",
        fields: {
          workspace: "mob",
          group: null,
          issue: null,
          category: "Meeting",
          from: "13:00",
          to: "13:30",
          date: "2026-10-16",
          note: "Planning",
        },
      },
    ],
    [
      ["timesheet", "edit", "ent-1", "--issue", "MOB-1"],
      { kind: "timesheet.edit", id: "ent-1", fields: { ...noFields, issue: "MOB-1" } },
    ],
    [["timesheet", "delete", "ent-1"], { kind: "timesheet.delete", id: "ent-1", yes: false }],
    [["timesheet", "delete", "ent-1", "-y"], { kind: "timesheet.delete", id: "ent-1", yes: true }],
  ] as const)("%p", (argv, command) => {
    expect(parseArgs([...argv])).toEqual({ ok: true, value: run(command as CliCommand) });
  });

  test.each([
    [["timesheet", "add", "extra"], "Unexpected argument: extra"],
    [["timesheet", "edit"], "timesheet edit expects <id>"],
    [["timesheet", "edit", "ent-1", "-w", "mob"], "--workspace does not apply to timesheet edit"],
    [["timesheet", "edit", "ent-1", "-g", "Banking"], "--group does not apply to timesheet edit"],
    [["timesheet", "add", "--all"], "--all does not apply to timesheet add"],
    [["timesheet", "week", "--place", "x"], "--place does not apply to timesheet week"],
  ])("rejects %p", (argv, message) => {
    const result = parseArgs(argv);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain(message);
  });

  test("a word the default subcommand cannot take is an unknown command", () => {
    expect(parseArgs(["timer", "2026-10-16"])).toMatchObject({
      ok: false,
      error: { message: "Unknown timer command: 2026-10-16" },
    });
  });
});

describe("parseArgs: work", () => {
  test.each([
    [["work"], { kind: "work.status", json: false }],
    [["work", "status", "--json"], { kind: "work.status", json: true }],
    [
      ["work", "start", "MOB-2841"],
      { kind: "work.start", issue: "MOB-2841", title: null, workspace: null },
    ],
    [
      ["work", "start", "mob-1", "--title", "Add login", "-w", "mob"],
      { kind: "work.start", issue: "mob-1", title: "Add login", workspace: "mob" },
    ],
    [["work", "finish"], { kind: "work.finish", workspace: null }],
    [["work", "finish", "-w", "mob"], { kind: "work.finish", workspace: "mob" }],
  ] as const)("%p", (argv, command) => {
    expect(parseArgs([...argv])).toEqual({ ok: true, value: run(command) });
  });

  test.each([
    [["work", "start"], "work start expects <issue>"],
    [["work", "finish", "--title", "x"], "--title does not apply to work finish"],
    [["work", "pause"], "Unknown work command: pause"],
  ])("rejects %p", (argv, message) => {
    expect(parseArgs(argv)).toMatchObject({ ok: false, error: { message } });
  });
});

describe("parseArgs: activity", () => {
  test.each([
    [["activity"], { kind: "activity", workspace: null, limit: null, json: false }],
    [
      ["activity", "-w", "mob", "-n", "5", "--json"],
      { kind: "activity", workspace: "mob", limit: "5", json: true },
    ],
    [
      ["activity", "--limit", "50"],
      { kind: "activity", workspace: null, limit: "50", json: false },
    ],
  ] as const)("%p", (argv, command) => {
    expect(parseArgs([...argv])).toEqual({ ok: true, value: run(command) });
  });

  test.each([
    [["activity", "today"], "Unexpected argument: today"],
    [["activity", "--title", "x"], "--title does not apply to activity"],
  ])("rejects %p", (argv, message) => {
    expect(parseArgs(argv)).toMatchObject({ ok: false, error: { message } });
  });
});

describe("parseArgs: note", () => {
  const here = { workspace: null, issue: null };
  test.each([
    [["note"], { kind: "note.show", ...here, json: false }],
    [
      ["note", "show", "--issue", "MOB-1", "-w", "mob", "--json"],
      { kind: "note.show", workspace: "mob", issue: "MOB-1", json: true },
    ],
    [["note", "save"], { kind: "note.save", ...here }],
    [
      ["note", "append", "Ask", "QA", "--issue", "MOB-1"],
      { kind: "note.append", text: "Ask QA", workspace: null, issue: "MOB-1" },
    ],
    [["note", "clear", "-w", "mob"], { kind: "note.clear", workspace: "mob", issue: null }],
    [["note", "list", "--json"], { kind: "note.list", json: true }],
  ] as const)("%p", (argv, command) => {
    expect(parseArgs([...argv])).toEqual({ ok: true, value: run(command) });
  });

  test.each([
    [["note", "append"], "note append expects <text>"],
    [["note", "list", "--issue", "x"], "--issue does not apply to note list"],
    [["note", "save", "text"], "Unexpected argument: text"],
    [["note", "edit"], "Unknown note command: edit"],
  ])("rejects %p", (argv, message) => {
    expect(parseArgs(argv)).toMatchObject({ ok: false, error: { message } });
  });
});

describe("parseArgs: plugin commands", () => {
  const PLUGINS: readonly PluginCommandSpec[] = [
    {
      group: "git",
      name: "status",
      isDefault: true,
      usage: "",
      minArgs: 0,
      maxArgs: 0,
      flags: {
        json: { type: "boolean", description: "json" },
        workspace: { type: "string", short: "w", description: "workspace" },
      },
      summary: "status",
    },
    {
      group: "git",
      name: "show",
      usage: "<ref>",
      minArgs: 1,
      maxArgs: 1,
      flags: { stat: { type: "boolean", short: "s", description: "stat" } },
      summary: "show",
    },
  ];
  const plugin = (
    name: string,
    args: string[],
    flags: Record<string, string | boolean | undefined>,
  ) => run({ kind: "plugin", invocation: { group: "git", name, args, flags } });

  test.each([
    [["git"], plugin("status", [], { json: undefined, workspace: undefined })],
    [["git", "status", "--json"], plugin("status", [], { json: true, workspace: undefined })],
    [["git", "-w", "mobile"], plugin("status", [], { json: undefined, workspace: "mobile" })],
    [["git", "show", "HEAD", "-s"], plugin("show", ["HEAD"], { stat: true })],
  ] as const)("%p", (argv, expected) => {
    expect(parseArgs([...argv], PLUGINS)).toEqual({ ok: true, value: expected });
  });

  test.each([
    [["git", "log"], "Unknown git command: log"],
    [["git", "show"], "git show expects <ref>"],
    [["git", "status", "--stat"], "--stat does not apply to git status"],
    [["git", "status", "extra"], "Unexpected argument: extra"],
  ])("rejects %p: %s", (argv, message) => {
    const result = parseArgs(argv, PLUGINS);
    expect(!result.ok && result.error.message).toBe(message);
  });

  test("a group with no default command needs one named", () => {
    const result = parseArgs(["git"], PLUGINS.slice(1));
    expect(!result.ok && result.error.message).toBe("Unknown git command:");
  });

  test("without the plugin, its commands are unknown", () => {
    const result = parseArgs(["git", "status"]);
    expect(!result.ok && result.error.message).toBe("Unknown command: git");
  });
});
