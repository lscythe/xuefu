import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { writeFileAtomic } from "../../../../src/infrastructure/filesystem/atomic-write";
import { makeTempDir } from "../../../support/temp-dir";

let dir: { path: string; cleanup: () => void };
beforeEach(() => {
  dir = makeTempDir();
});
afterEach(() => dir.cleanup());

describe("writeFileAtomic", () => {
  test("writes a new file and leaves no temporary files behind", async () => {
    const target = join(dir.path, "config.yml");
    const result = await writeFileAtomic(target, "version: 1\n", { overwrite: false });
    expect(result).toEqual({ ok: true, value: undefined });
    expect(readFileSync(target, "utf8")).toBe("version: 1\n");
    expect(readdirSync(dir.path)).toEqual(["config.yml"]);
  });

  test("replaces an existing file when overwrite is allowed", async () => {
    const target = join(dir.path, "config.yml");
    writeFileSync(target, "old");
    await writeFileAtomic(target, "new", { overwrite: true });
    expect(readFileSync(target, "utf8")).toBe("new");
  });

  test("refuses to clobber an existing file without explicit overwrite", async () => {
    const target = join(dir.path, "timesheet.xlsx");
    writeFileSync(target, "company data");
    const result = await writeFileAtomic(target, "new", { overwrite: false });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("filesystem");
      expect(result.error.context["code"]).toBe("EEXIST");
      expect(result.error.hint).toBeDefined();
    }
    expect(readFileSync(target, "utf8")).toBe("company data");
    expect(readdirSync(dir.path)).toEqual(["timesheet.xlsx"]);
  });

  test("keeps the original intact and cleans up when the final rename fails", async () => {
    const target = join(dir.path, "occupied");
    mkdirSync(join(target, "child"), { recursive: true });
    const result = await writeFileAtomic(target, "data", { overwrite: true });
    expect(result.ok).toBe(false);
    expect(readdirSync(dir.path)).toEqual(["occupied"]);
    expect(statSync(target).isDirectory()).toBe(true);
  });

  test("applies the requested file mode", async () => {
    const target = join(dir.path, "private.json");
    await writeFileAtomic(target, "{}", { overwrite: false, mode: 0o600 });
    expect(statSync(target).mode & 0o777).toBe(0o600);
  });

  test("fails with a filesystem error when the directory does not exist", async () => {
    const result = await writeFileAtomic(join(dir.path, "missing", "x"), "data", {
      overwrite: false,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.operation).toBe("write");
  });

  test("writes binary content unchanged", async () => {
    const target = join(dir.path, "blob.bin");
    const bytes = new Uint8Array([0, 255, 1, 254]);
    await writeFileAtomic(target, bytes, { overwrite: false });
    expect(new Uint8Array(readFileSync(target))).toEqual(bytes);
  });
});
