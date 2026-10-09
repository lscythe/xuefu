import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, realpathSync } from "node:fs";
import { join } from "node:path";
import pkg from "../../package.json" with { type: "json" };
import { MIGRATIONS } from "../../src/infrastructure/persistence/migrations/catalog";
import { makeTempDir } from "../support/temp-dir";

const ENTRY = join(import.meta.dir, "..", "..", "src", "main.ts");

let dir: { path: string; cleanup: () => void };
beforeEach(() => {
  dir = makeTempDir("xuefu-e2e-");
});
afterEach(() => dir.cleanup());

const xuefuIn = (cwd: string, ...args: string[]) => xuefuWith(cwd, null, ...args);

async function xuefuWith(cwd: string, stdin: string | null, ...args: string[]) {
  const proc = Bun.spawn([process.execPath, ENTRY, ...args], {
    cwd,
    stdin: stdin === null ? "ignore" : new TextEncoder().encode(stdin),
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

const xuefu = (...args: string[]) => xuefuIn(dir.path, ...args);

describe("xuefu entrypoint", () => {
  test("prints the package version", async () => {
    const result = await xuefu("--version");
    expect(result).toEqual({ code: 0, stdout: `${pkg.version}\n`, stderr: "" });
  });

  test("diagnostics works against isolated directories", async () => {
    const result = await xuefu("diagnostics", "--json");
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout).database.schemaVersion).toBe(MIGRATIONS.length);
    expect(existsSync(join(dir.path, "data", "xuefu.db"))).toBe(true);
  });

  test("without a terminal, a bare invocation explains the cockpit needs one", async () => {
    const result = await xuefu();
    expect(result.code).toBe(64);
    expect(result.stderr).toContain("needs an interactive terminal");
  });

  test("usage errors exit with 64", async () => {
    expect((await xuefu("--definitely-not-a-flag")).code).toBe(64);
  });

  test("registers the current folder as a workspace and finds it from a subfolder", async () => {
    const project = join(realpathSync(dir.path), "mobile-banking");
    mkdirSync(join(project, ".git", "refs"), { recursive: true });
    expect((await xuefuIn(project, "workspace", "add", "--name", "Mobile Banking")).code).toBe(0);
    expect(await xuefuIn(join(project, ".git", "refs"), "workspace", "which")).toEqual({
      code: 0,
      stdout: "mobile-banking\n",
      stderr: "",
    });
    const listed = JSON.parse((await xuefu("workspace", "list", "--json")).stdout);
    expect(listed).toMatchObject([{ id: "mobile-banking", capabilities: { git: true } }]);
  });

  test("note save reads the text piped in", async () => {
    const project = join(realpathSync(dir.path), "project");
    mkdirSync(project);
    await xuefuIn(project, "workspace", "add");
    const saved = await xuefuWith(project, "Staging needs the VPN\n", "note", "save");
    expect(saved).toMatchObject({ code: 0, stdout: "✓ Saved the note for project\n" });
    expect((await xuefuIn(project, "note")).stdout).toBe("Staging needs the VPN\n");
  });
});
