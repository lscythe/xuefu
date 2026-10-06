import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AbsolutePath } from "../../../../src/domain/shared/path";
import { fsWorkspaceProbe } from "../../../../src/infrastructure/filesystem/workspace-probe";
import { makeTempDir } from "../../../support/temp-dir";

let dir: { path: string; cleanup: () => void };
let root: string;
const probe = fsWorkspaceProbe;

beforeEach(() => {
  dir = makeTempDir();
  // The temp dir itself may sit behind a symlink (/var → /private/var on macOS).
  root = realpathSync(dir.path);
});
afterEach(() => dir.cleanup());

function folder(...segments: string[]): string {
  const path = join(root, ...segments);
  mkdirSync(path, { recursive: true });
  return path;
}

describe("FsWorkspaceProbe", () => {
  test("a plain folder has no capabilities", async () => {
    const path = folder("plain");
    expect(await probe.probe(path as AbsolutePath)).toEqual({
      ok: true,
      value: { path: path as AbsolutePath, capabilities: { git: false, gradle: false } },
    });
  });

  test("detects a git repository and a Gradle build", async () => {
    const path = folder("android-app");
    mkdirSync(join(path, ".git"));
    writeFileSync(join(path, "settings.gradle.kts"), "");
    const result = await probe.probe(path as AbsolutePath);
    expect(result.ok && result.value.capabilities).toEqual({ git: true, gradle: true });
  });

  test("detects a git worktree (.git file) and Groovy Gradle settings", async () => {
    const path = folder("worktree");
    writeFileSync(join(path, ".git"), "gitdir: /elsewhere/.git/worktrees/x\n");
    writeFileSync(join(path, "settings.gradle"), "");
    const result = await probe.probe(path as AbsolutePath);
    expect(result.ok && result.value.capabilities).toEqual({ git: true, gradle: true });
  });

  test("resolves symlinks to the canonical folder", async () => {
    const target = folder("real");
    const link = join(root, "link");
    symlinkSync(target, link);
    const result = await probe.probe(link as AbsolutePath);
    expect(result.ok && result.value.path).toBe(target as AbsolutePath);
  });

  test("a missing folder is a filesystem error", async () => {
    const path = join(root, "missing");
    const result = await probe.probe(path as AbsolutePath);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatchObject({ kind: "filesystem", path, operation: "realpath" });
      expect(result.error.message).toBe("Folder does not exist");
    }
  });

  test("a symlink loop cannot be resolved", async () => {
    const a = join(root, "loop-a");
    const b = join(root, "loop-b");
    symlinkSync(b, a);
    symlinkSync(a, b);
    const result = await probe.probe(a as AbsolutePath);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toBe("Unable to read folder");
  });

  test("a file is not a folder", async () => {
    const path = join(root, "file.txt");
    writeFileSync(path, "");
    const result = await probe.probe(path as AbsolutePath);
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.error).toMatchObject({ kind: "filesystem", message: "Not a folder" });
  });
});
