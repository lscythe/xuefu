import { describe, expect, test } from "bun:test";
import { type ConfigInput, loadConfig } from "../../../../src/infrastructure/config/load-config";
import { DEFAULT_CONFIG } from "../../../../src/infrastructure/config/schema";

const GLOBAL = "/Users/dev/.config/xuefu/config.yml";

function input(overrides: Partial<ConfigInput> = {}): ConfigInput {
  return { globalFile: { path: GLOBAL, text: null }, env: {}, cli: {}, ...overrides };
}

function expectConfigError(result: ReturnType<typeof loadConfig>) {
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("expected failure");
  expect(result.error.kind).toBe("configuration");
  return result.error;
}

describe("loadConfig: defaults and precedence", () => {
  test("defaults alone produce a valid configuration", () => {
    const result = loadConfig(input());
    expect(result.ok && result.value.config).toEqual(DEFAULT_CONFIG);
  });

  test("precedence is defaults < global file < environment < CLI", () => {
    const file = "version: 1\nlogging:\n  level: warn\n  maxFiles: 7\nui:\n  icons: nerd\n";
    const fromFile = loadConfig(input({ globalFile: { path: GLOBAL, text: file } }));
    expect(fromFile.ok && fromFile.value.config.logging).toEqual({
      ...DEFAULT_CONFIG.logging,
      level: "warn",
      maxFiles: 7,
    });

    const fromEnv = loadConfig(
      input({ globalFile: { path: GLOBAL, text: file }, env: { XUEFU_LOG_LEVEL: "error" } }),
    );
    expect(fromEnv.ok && fromEnv.value.config.logging.level).toBe("error");

    const fromCli = loadConfig(
      input({
        globalFile: { path: GLOBAL, text: file },
        env: { XUEFU_LOG_LEVEL: "error" },
        cli: { logging: { level: "trace" } },
      }),
    );
    expect(fromCli.ok && fromCli.value.config.logging).toEqual({
      ...DEFAULT_CONFIG.logging,
      level: "trace",
      maxFiles: 7,
    });
    expect(fromCli.ok && fromCli.value.config.ui.icons).toBe("nerd");
  });

  test("reports which sources contributed", () => {
    const result = loadConfig(
      input({
        globalFile: { path: GLOBAL, text: "version: 1\n" },
        env: { XUEFU_LOG_LEVEL: "warn" },
      }),
    );
    expect(result.ok && result.value.sources).toEqual([
      { name: "defaults" },
      { name: "global", path: GLOBAL },
      { name: "environment", variables: ["XUEFU_LOG_LEVEL"] },
    ]);
  });

  test("a missing or empty global file is not an error", () => {
    expect(loadConfig(input({ globalFile: { path: GLOBAL, text: null } })).ok).toBe(true);
    expect(
      loadConfig(input({ globalFile: { path: GLOBAL, text: "  \n# only comments\n" } })).ok,
    ).toBe(true);
  });
});

describe("loadConfig: actionable errors", () => {
  test("YAML syntax errors include line and column", () => {
    const error = expectConfigError(
      loadConfig(input({ globalFile: { path: GLOBAL, text: "version: 1\nlogging: [unclosed\n" } })),
    );
    expect(error.source).toBe(GLOBAL);
    expect(error.issues[0]?.line).toBeGreaterThanOrEqual(2);
  });

  test("duplicate keys are rejected", () => {
    const error = expectConfigError(
      loadConfig(input({ globalFile: { path: GLOBAL, text: "version: 1\nui: {}\nui: {}\n" } })),
    );
    expect(error.issues[0]?.line).toBe(3);
  });

  test("schema errors point at the offending key's position", () => {
    const text = "version: 1\nlogging:\n  level: loud\n";
    const error = expectConfigError(loadConfig(input({ globalFile: { path: GLOBAL, text } })));
    expect(error.issues).toEqual([
      expect.objectContaining({ path: "logging.level", line: 3, column: 10 }),
    ]);
  });

  test("unknown keys (typos) are rejected with their position", () => {
    const text = "version: 1\nlogging:\n  levle: debug\n";
    const error = expectConfigError(loadConfig(input({ globalFile: { path: GLOBAL, text } })));
    expect(error.issues[0]).toMatchObject({ path: "logging.levle", line: 3, column: 3 });
  });

  test("a non-empty file without a version is rejected with a hint", () => {
    const error = expectConfigError(
      loadConfig(input({ globalFile: { path: GLOBAL, text: "logging:\n  level: info\n" } })),
    );
    expect(error.hint).toContain("version: 1");
  });

  test("a config written for a newer XueFu is rejected rather than reinterpreted", () => {
    const error = expectConfigError(
      loadConfig(input({ globalFile: { path: GLOBAL, text: "version: 2\n" } })),
    );
    expect(error.message).toContain("newer");
  });

  test("a top-level list or scalar is rejected", () => {
    expectConfigError(loadConfig(input({ globalFile: { path: GLOBAL, text: "- a\n- b\n" } })));
    expectConfigError(loadConfig(input({ globalFile: { path: GLOBAL, text: "hello\n" } })));
  });

  test("invalid environment values name the variable", () => {
    const error = expectConfigError(loadConfig(input({ env: { XUEFU_LOG_LEVEL: "verbose" } })));
    expect(error.source).toBe("environment");
    expect(error.issues[0]?.path).toBe("XUEFU_LOG_LEVEL");
  });

  test("invalid CLI overrides are reported against the CLI", () => {
    const error = expectConfigError(loadConfig(input({ cli: { logging: { level: "loud" } } })));
    expect(error.source).toBe("cli");
  });
});

describe("loadConfig: secrets", () => {
  test("plaintext secrets in config files are rejected without echoing the value", () => {
    const text = "version: 1\nui:\n  icons: unicode\n  apiToken: abc123supersecret\n";
    const error = expectConfigError(loadConfig(input({ globalFile: { path: GLOBAL, text } })));
    expect(error.issues[0]).toMatchObject({ path: "ui.apiToken", line: 4 });
    expect(error.hint).toContain("env");
    expect(JSON.stringify(error)).not.toContain("abc123supersecret");
  });
});
