import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readConfigFile } from "../../../../src/infrastructure/config/read-config-file";
import { makeTempDir } from "../../../support/temp-dir";

let dir: { path: string; cleanup: () => void };
beforeEach(() => {
  dir = makeTempDir();
});
afterEach(() => dir.cleanup());

describe("readConfigFile", () => {
  test("returns the file text", async () => {
    const path = join(dir.path, "config.yml");
    writeFileSync(path, "version: 1\n");
    expect(await readConfigFile(path)).toEqual({ ok: true, value: { path, text: "version: 1\n" } });
  });

  test("a missing file yields null text", async () => {
    const path = join(dir.path, "absent.yml");
    expect(await readConfigFile(path)).toEqual({ ok: true, value: { path, text: null } });
  });

  test("other read failures are filesystem errors", async () => {
    const path = join(dir.path, "a-directory");
    mkdirSync(path);
    const result = await readConfigFile(path);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("filesystem");
  });
});
