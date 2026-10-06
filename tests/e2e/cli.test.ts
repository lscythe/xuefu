import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import pkg from "../../package.json" with { type: "json" };
import { makeTempDir } from "../support/temp-dir";

const ENTRY = join(import.meta.dir, "..", "..", "src", "main.ts");

let dir: { path: string; cleanup: () => void };
beforeEach(() => {
  dir = makeTempDir("xuefu-e2e-");
});
afterEach(() => dir.cleanup());

async function xuefu(...args: string[]) {
  const proc = Bun.spawn([process.execPath, ENTRY, ...args], {
    env: {
      PATH: process.env["PATH"] ?? "",
      HOME: dir.path,
      XUEFU_CONFIG_DIR: join(dir.path, "config"),
      XUEFU_DATA_DIR: join(dir.path, "data"),
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { code, stdout, stderr };
}

describe("xuefu entrypoint", () => {
  test("prints the package version", async () => {
    const result = await xuefu("--version");
    expect(result).toEqual({ code: 0, stdout: `${pkg.version}\n`, stderr: "" });
  });

  test("diagnostics works against isolated directories", async () => {
    const result = await xuefu("diagnostics", "--json");
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout).database.schemaVersion).toBe(1);
    expect(existsSync(join(dir.path, "data", "xuefu.db"))).toBe(true);
  });

  test("usage errors exit with 64", async () => {
    expect((await xuefu("--definitely-not-a-flag")).code).toBe(64);
  });
});
