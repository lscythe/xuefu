import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AbsolutePath } from "../../../../src/domain/shared/path";
import { ok } from "../../../../src/domain/shared/result";
import { BunProcessRunner } from "../../../../src/infrastructure/process/bun-process-runner";
import type { CommitMessage } from "../../../../src/plugins/git/domain/commit";
import { stagedFiles, unstagedFiles } from "../../../../src/plugins/git/domain/status";
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

const message = (text: string) => text as CommitMessage;

async function changed(path: AbsolutePath) {
  const read = await status(path);
  return {
    staged: stagedFiles(read ?? never()).map((file) => file.path),
    unstaged: unstagedFiles(read ?? never()).map((file) => file.path),
    untracked: read?.untracked,
  };
}

function never(): never {
  throw new Error("not a repository");
}

describe("cliGit stage, unstage and commit", () => {
  test("stages and unstages chosen files, from a subfolder too", async () => {
    const { path, write } = repo();
    mkdirSync(join(path, "app"));
    write("app/main.ts", "main\n");
    write("README.md", "changed\n");
    write("odd [1].txt", "odd\n");
    const sub = join(path, "app") as AbsolutePath;

    expect(await client.stage(sub, ["README.md", "odd [1].txt"])).toEqual(ok(undefined));
    expect(await changed(path)).toEqual({
      staged: ["README.md", "odd [1].txt"],
      unstaged: [],
      untracked: ["app/"],
    });
    expect(await client.unstage(sub, ["README.md"])).toEqual(ok(undefined));
    expect(await changed(path)).toEqual({
      staged: ["odd [1].txt"],
      unstaged: ["README.md"],
      untracked: ["app/"],
    });
  });

  test("all stages deletions and new files, and unstages everything", async () => {
    const { path, write, git: run } = repo();
    write("new.txt", "new\n");
    run("rm", "-q", "--cached", "README.md");
    rmSync(join(path, "README.md"));
    expect(await client.stage(path, "all")).toEqual(ok(undefined));
    expect(await changed(path)).toEqual({
      staged: ["README.md", "new.txt"],
      unstaged: [],
      untracked: [],
    });
    expect(await client.unstage(path, "all")).toEqual(ok(undefined));
    expect(await changed(path)).toEqual({
      staged: [],
      unstaged: ["README.md"],
      untracked: ["new.txt"],
    });
  });

  test("a rename is unstaged by naming both its sides", async () => {
    const { path, git: run } = repo();
    run("mv", "README.md", "READ.md");
    expect(await client.unstage(path, ["READ.md", "README.md"])).toEqual(ok(undefined));
    expect(await changed(path)).toEqual({
      staged: [],
      unstaged: ["README.md"],
      untracked: ["READ.md"],
    });
  });

  test("before the first commit, files unstage all the same", async () => {
    const dir = makeTempDir();
    cleanups.push(dir.cleanup);
    const path = realpathSync(dir.path) as AbsolutePath;
    git(path, "init", "-q");
    writeFileSync(join(path, "a.txt"), "a\n");
    expect(await client.stage(path, "all")).toEqual(ok(undefined));
    expect(await client.unstage(path, ["a.txt"])).toEqual(ok(undefined));
    expect((await status(path))?.untracked).toEqual(["a.txt"]);
  });

  test("commits what is staged and gives the new commit's id", async () => {
    const { path, write, git: run } = repo();
    write("README.md", "changed\n");
    write("other.txt", "not staged\n");
    await client.stage(path, ["README.md"]);
    const made = await client.commit(path, message("Change the readme\n\n# kept, not a comment"));
    expect(made).toEqual(ok(run("rev-parse", "HEAD").trim()));
    expect(run("log", "-1", "--format=%B").trim()).toBe(
      "Change the readme\n\n# kept, not a comment",
    );
    expect(await changed(path)).toEqual({ staged: [], unstaged: [], untracked: ["other.txt"] });
  });

  test("nothing staged, or a hook saying no, is a failure that says why", async () => {
    const { path, write, git: run } = repo();
    const empty = await client.commit(path, message("Nothing"));
    expect(!empty.ok && empty.error.message).toStartWith("git commit failed: ");

    const hook = join(path, ".git", "hooks", "pre-commit");
    writeFileSync(hook, "#!/bin/sh\necho 'checking'\necho 'tests failed' >&2\nexit 1\n");
    chmodSync(hook, 0o755);
    write("README.md", "changed\n");
    run("add", "README.md");
    const refused = await client.commit(path, message("Change"));
    expect(!refused.ok && refused.error.message).toBe("git commit failed: tests failed");
    expect(run("log", "--format=%s").trim()).toBe("first");
  });
});
