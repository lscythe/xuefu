import { describe, expect, test } from "bun:test";
import { resolvePaths } from "../../../../src/infrastructure/config/paths";

const HOME = "/Users/dev";

describe("resolvePaths", () => {
  test("defaults to ~/.config/xuefu and ~/.local/share/xuefu", () => {
    const result = resolvePaths({ env: {}, home: HOME });
    expect(result).toEqual({
      ok: true,
      value: {
        configDir: "/Users/dev/.config/xuefu",
        configFile: "/Users/dev/.config/xuefu/config.yml",
        dataDir: "/Users/dev/.local/share/xuefu",
        databaseFile: "/Users/dev/.local/share/xuefu/xuefu.db",
        backupDir: "/Users/dev/.local/share/xuefu/backups",
        logDir: "/Users/dev/.local/share/xuefu/logs",
        logFile: "/Users/dev/.local/share/xuefu/logs/xuefu.log",
      },
    });
  });

  test("honours absolute XDG base directories", () => {
    const result = resolvePaths({
      env: { XDG_CONFIG_HOME: "/xdg/config", XDG_DATA_HOME: "/xdg/data" },
      home: HOME,
    });
    expect(result.ok && result.value.configDir).toBe("/xdg/config/xuefu");
    expect(result.ok && result.value.dataDir).toBe("/xdg/data/xuefu");
  });

  test("ignores relative XDG values as the XDG spec requires", () => {
    const result = resolvePaths({ env: { XDG_CONFIG_HOME: "relative" }, home: HOME });
    expect(result.ok && result.value.configDir).toBe("/Users/dev/.config/xuefu");
  });

  test("XUEFU_* overrides take precedence over XDG", () => {
    const result = resolvePaths({
      env: { XUEFU_CONFIG_DIR: "/tmp/cfg", XUEFU_DATA_DIR: "/tmp/data", XDG_DATA_HOME: "/xdg" },
      home: HOME,
    });
    expect(result.ok && result.value.configFile).toBe("/tmp/cfg/config.yml");
    expect(result.ok && result.value.databaseFile).toBe("/tmp/data/xuefu.db");
  });

  test("a relative XUEFU_* override is an error, not silently ignored", () => {
    const result = resolvePaths({ env: { XUEFU_DATA_DIR: "data" }, home: HOME });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("configuration");
      expect(result.error.issues[0]?.path).toBe("XUEFU_DATA_DIR");
    }
  });

  test("empty values count as unset", () => {
    const result = resolvePaths({ env: { XUEFU_DATA_DIR: "", XDG_DATA_HOME: "" }, home: HOME });
    expect(result.ok && result.value.dataDir).toBe("/Users/dev/.local/share/xuefu");
  });

  test("requires an absolute home directory", () => {
    expect(resolvePaths({ env: {}, home: "" }).ok).toBe(false);
  });
});
