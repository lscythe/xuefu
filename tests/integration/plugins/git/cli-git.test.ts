import { afterEach, describe, expect, test } from "bun:test";
import { realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AbsolutePath } from "../../../../src/domain/shared/path";
import { BunProcessRunner } from "../../../../src/infrastructure/process/bun-process-runner";
import { cliGit } from "../../../../src/plugins/git/integrations/cli-git";
import { GIT_ENV, git, makeRepo } from "../../../support/git-repo";
import { makeTempDir } from "../../../support/temp-dir";

const client = cliGit(new BunProcessRunner(GIT_ENV));
const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

function repo() {
  const made = makeRepo();
  cleanups.push(made.cleanup);
  return made;
}

async function status(path: AbsolutePath) {
  const read = await client.status(path);
  if (!read.ok) throw new Error(read.error.message);
  return read.value;
}

describe("cliGit status", () => {
  test("a clean repository: its branch and commit, nothing changed", async () => {
    const { path, git: run } = repo();
    expect(await status(path)).toEqual({
      branch: "main",
      commit: run("rev-parse", "HEAD").trim(),
      upstream: null,
      ahead: 0,
      behind: 0,
      changes: [],
      conflicts: [],
      untracked: [],
      stashes: 0,
    });
  });

  test("staged, unstaged, renamed and untracked files, from a subfolder too", async () => {
    const { path, write, git: run } = repo();
    write("a.txt", "a\n");
    write("b.txt", "b\n");
    run("add", "a.txt", "b.txt");
    run("commit", "-q", "-m", "two files");
    write("README.md", "changed\n");
    run("add", "README.md");
    write("a.txt", "a, changed\n");
    run("mv", "b.txt", "c.txt");
    write("new file.txt", "new\n");

    const read = await status(path);
    expect(read?.changes).toEqual([
      { path: "README.md", from: null, staged: "modified", unstaged: "unchanged" },
      { path: "a.txt", from: null, staged: "unchanged", unstaged: "modified" },
      { path: "c.txt", from: "b.txt", staged: "renamed", unstaged: "unchanged" },
    ]);
    expect(read?.untracked).toEqual(["new file.txt"]);
  });

  test("counts stashes and reports a detached HEAD", async () => {
    const { path, write, git: run } = repo();
    write("README.md", "stash me\n");
    run("stash", "-q");
    run("checkout", "-q", "--detach");
    expect(await status(path)).toMatchObject({ branch: null, stashes: 1 });
  });

  test("how far the branch is ahead of and behind its upstream", async () => {
    const origin = repo();
    const clone = makeTempDir();
    cleanups.push(clone.cleanup);
    const local = realpathSync(clone.path) as AbsolutePath;
    git(local, "clone", "-q", origin.path, ".");
    origin.write("upstream.txt", "1\n");
    origin.git("add", ".");
    origin.git("commit", "-q", "-m", "upstream");
    git(local, "fetch", "-q");
    git(local, "commit", "-q", "--allow-empty", "-m", "local 1");
    git(local, "commit", "-q", "--allow-empty", "-m", "local 2");
    expect(await status(local)).toMatchObject({
      branch: "main",
      upstream: "origin/main",
      ahead: 2,
      behind: 1,
    });
  });

  test("merge conflicts are listed apart from other changes", async () => {
    const { path, write, git: run } = repo();
    run("checkout", "-q", "-b", "other");
    write("README.md", "theirs\n");
    run("commit", "-q", "-am", "theirs");
    run("checkout", "-q", "main");
    write("README.md", "ours\n");
    run("commit", "-q", "-am", "ours");
    const merged = Bun.spawnSync(["git", "merge", "other"], { cwd: path, env: GIT_ENV });
    expect(merged.exitCode).not.toBe(0);
    expect(await status(path)).toMatchObject({ conflicts: ["README.md"], changes: [] });
  });

  test("a folder outside any repository is null, not an error", async () => {
    const plain = makeTempDir();
    cleanups.push(plain.cleanup);
    expect(await status(realpathSync(plain.path) as AbsolutePath)).toBeNull();
  });

  test("other failures name what git said", async () => {
    const { path } = repo();
    writeFileSync(join(path, ".git", "index"), "garbage");
    const read = await client.status(path);
    expect(!read.ok && read.error).toMatchObject({ kind: "process", command: "git" });
    expect(!read.ok && read.error.message).toStartWith("git status failed: ");
  });
});
