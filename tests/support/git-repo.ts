import { realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AbsolutePath } from "../../src/domain/shared/path";
import { makeTempDir } from "./temp-dir";

/**
 * Environment for git in tests: none of the developer's config (signing, hooks, aliases), a fixed
 * author, and a branch named main.
 */
export const GIT_ENV: Readonly<Record<string, string>> = {
  PATH: process.env["PATH"] ?? "",
  HOME: "/nonexistent",
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_AUTHOR_NAME: "XueFu Test",
  GIT_AUTHOR_EMAIL: "test@example.com",
  GIT_COMMITTER_NAME: "XueFu Test",
  GIT_COMMITTER_EMAIL: "test@example.com",
};

export function git(dir: string, ...args: string[]): string {
  const ran = Bun.spawnSync(["git", "-c", "init.defaultBranch=main", ...args], {
    cwd: dir,
    env: GIT_ENV,
  });
  if (ran.exitCode !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${ran.stderr.toString()}`);
  }
  return ran.stdout.toString();
}

/** A fresh repository with one commit of `README.md`; `write` adds or changes files. */
export function makeRepo(prefix = "xuefu-git-") {
  const dir = makeTempDir(prefix);
  const path = realpathSync(dir.path) as AbsolutePath;
  const write = (file: string, text: string) => writeFileSync(join(path, file), text);
  git(path, "init", "-q");
  write("README.md", "hello\n");
  git(path, "add", "README.md");
  git(path, "commit", "-q", "-m", "first");
  return { path, write, git: (...args: string[]) => git(path, ...args), cleanup: dir.cleanup };
}
