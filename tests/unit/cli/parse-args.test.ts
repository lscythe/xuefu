import { describe, expect, test } from "bun:test";
import { parseArgs } from "../../../src/cli/parse-args";

describe("parseArgs", () => {
  test.each([
    [[], { kind: "help" }],
    [["--help"], { kind: "help" }],
    [["-h"], { kind: "help" }],
    [["--version"], { kind: "version" }],
    [["-v"], { kind: "version" }],
    [["diagnostics"], { kind: "diagnostics", json: false, overrides: {} }],
    [["diagnostics", "--json"], { kind: "diagnostics", json: true, overrides: {} }],
    [
      ["--debug", "diagnostics"],
      { kind: "diagnostics", json: false, overrides: { logging: { level: "debug" } } },
    ],
    [
      ["diagnostics", "--log-level", "warn"],
      { kind: "diagnostics", json: false, overrides: { logging: { level: "warn" } } },
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
