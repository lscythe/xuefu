import { describe, expect, test } from "bun:test";
import { type CliCommand, type CliInvocation, parseArgs } from "../../../src/cli/parse-args";

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
