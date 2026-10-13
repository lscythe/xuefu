import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { PutBack } from "../../../../src/application/ports/agent";
import type { AbsolutePath } from "../../../../src/domain/shared/path";
import { gitCheckout } from "../../../../src/infrastructure/agent/branch-checkout";
import { BunProcessRunner } from "../../../../src/infrastructure/process/bun-process-runner";
import { GIT_ENV, git, makeRepo } from "../../../support/git-repo";
import { makeTempDir } from "../../../support/temp-dir";

const checkout = gitCheckout(new BunProcessRunner(GIT_ENV));
const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

/** A repository on "the server" with a pull request's branch, and a clone of it on main. */
function clone() {
  const origin = makeRepo("xuefu-origin-");
  cleanups.push(origin.cleanup);
  origin.git("switch", "-q", "-c", "feature/MOB-1");
  origin.write("feature.kt", "fun pay() = 1\n");
  origin.git("add", "feature.kt");
  origin.git("commit", "-q", "-m", "pay");
  origin.git("switch", "-q", "main");
  const dir = makeTempDir("xuefu-clone-");
  cleanups.push(dir.cleanup);
  git(dir.path, "clone", "-q", origin.path, "app");
  const path = join(dir.path, "app") as AbsolutePath;
  const run = (...args: string[]) => git(path, ...args).trim();
  const write = (file: string, text: string) => writeFileSync(join(path, file), text);
  const read = (file: string) => readFileSync(join(path, file), "utf8");
  return { origin, path, run, write, read, branch: () => run("branch", "--show-current") };
}

/** Checks out `branch`, keeping what it says. */
async function checkOut(path: AbsolutePath, branch = "feature/MOB-1", signal?: AbortSignal) {
  const said: string[] = [];
  const back = await checkout.checkout(
    path,
    branch,
    (text, failed) => said.push(failed ? `! ${text}` : text),
    signal ?? new AbortController().signal,
  );
  return { said, back };
}

const text = (done: PutBack) => (done.ok ? done.value : `! ${done.error.message}`);

describe("gitCheckout", () => {
  test("checks out the branch as on origin, then puts back the branch it was on", async () => {
    const app = clone();
    const tip = app.origin.git("rev-parse", "--short", "feature/MOB-1").trim();
    const { said, back } = await checkOut(app.path);
    expect(said).toEqual([`Checked out feature/MOB-1 at ${tip}.`]);
    expect(app.branch()).toBe("feature/MOB-1");
    expect(app.run("rev-parse", "--abbrev-ref", "@{upstream}")).toBe("origin/feature/MOB-1");
    expect(existsSync(join(app.path, "feature.kt"))).toBe(true);

    expect(text(await (back as () => Promise<PutBack>)())).toBe("Back on main.");
    expect(app.branch()).toBe("main");
  });

  test("uncommitted changes are stashed first and come back as they were", async () => {
    const app = clone();
    app.write("README.md", "staged\n");
    app.run("add", "README.md");
    app.write("README.md", "staged, then changed\n");
    app.write("notes.txt", "untracked\n");
    const { said, back } = await checkOut(app.path);
    expect(said[0]).toBe(
      'Stashed your uncommitted changes as "xuefu: before reviewing feature/MOB-1".',
    );
    expect(app.run("status", "--porcelain")).toBe("");

    // A stash of the user's own, made during the review, is left where it is.
    app.write("feature.kt", "fun pay() = 2\n");
    app.run("stash", "push", "-q", "-m", "mine");

    expect(text(await (back as () => Promise<PutBack>)())).toBe(
      "Back on main, with your uncommitted changes.",
    );
    expect(app.read("README.md")).toBe("staged, then changed\n");
    expect(app.read("notes.txt")).toBe("untracked\n");
    expect(app.run("diff", "--cached", "--name-only")).toBe("README.md");
    expect(app.run("stash", "list", "--format=%s")).toBe("On feature/MOB-1: mine");
  });

  test("changes made during the review keep the branch checked out, saying where yours are", async () => {
    const app = clone();
    app.write("README.md", "mine\n");
    const { back } = await checkOut(app.path);
    app.write("feature.kt", "fun pay() = 3\n");
    const done = await (back as () => Promise<PutBack>)();
    expect(text(done)).toBe(
      "! feature/MOB-1 was left checked out, as it has changes made during the review. " +
        'Your uncommitted changes are stashed as "xuefu: before reviewing feature/MOB-1".',
    );
    expect(app.branch()).toBe("feature/MOB-1");
  });

  test("a stash dropped meanwhile, or one that no longer applies, is said so", async () => {
    const dropped = clone();
    dropped.write("README.md", "mine\n");
    const first = await checkOut(dropped.path);
    dropped.run("stash", "drop", "-q");
    expect(text(await (first.back as () => Promise<PutBack>)())).toBe(
      "! Back on main, but the stash of your uncommitted changes is gone.",
    );

    const moved = clone();
    moved.write("README.md", "mine\n");
    const second = await checkOut(moved.path);
    // main moves on under the review, to a commit the stash does not apply to.
    moved.run("branch", "-f", "main", "origin/feature/MOB-1");
    moved.write("README.md", "theirs\n");
    moved.run("commit", "-qam", "theirs");
    moved.run("branch", "-f", "main", "HEAD");
    moved.run("reset", "-q", "--hard", "origin/feature/MOB-1");
    const done = text(await (second.back as () => Promise<PutBack>)());
    expect(done).toStartWith("! Back on main, but your uncommitted changes could not be put back:");
    expect(done).toEndWith(
      'Your uncommitted changes are stashed as "xuefu: before reviewing feature/MOB-1".',
    );
  });

  test("a local branch of that name is brought up to origin's, or reviewed as it is", async () => {
    const behind = clone();
    behind.run("branch", "feature/MOB-1", "main");
    const { said } = await checkOut(behind.path);
    expect(said).toHaveLength(1);
    expect(behind.run("rev-parse", "HEAD")).toBe(behind.run("rev-parse", "origin/feature/MOB-1"));

    const diverged = clone();
    diverged.run("switch", "-q", "-c", "feature/MOB-1");
    diverged.write("own.txt", "own\n");
    diverged.run("add", "own.txt");
    diverged.run("commit", "-qm", "own");
    diverged.run("switch", "-q", "main");
    const again = await checkOut(diverged.path);
    expect(again.said[0]).toStartWith(
      "! Your feature/MOB-1 could not be brought up to origin's; it is reviewed as it is:",
    );
    expect(diverged.branch()).toBe("feature/MOB-1");
  });

  test("on the branch already, it is brought up to date and nothing is put back", async () => {
    const app = clone();
    app.run("switch", "-q", "feature/MOB-1");
    app.origin.git("switch", "-q", "feature/MOB-1");
    app.origin.write("more.kt", "more\n");
    app.origin.git("add", "more.kt");
    app.origin.git("commit", "-q", "-m", "more");
    const tip = app.origin.git("rev-parse", "--short", "HEAD").trim();
    const { said, back } = await checkOut(app.path);
    expect(said).toEqual([`feature/MOB-1 was already checked out; it is reviewed at ${tip}.`]);
    expect(back).toBeNull();
    expect(existsSync(join(app.path, "more.kt"))).toBe(true);
  });

  test("from a detached HEAD, it puts back that commit", async () => {
    const app = clone();
    const head = app.run("rev-parse", "HEAD");
    app.run("switch", "-q", "--detach", head);
    const { back } = await checkOut(app.path);
    expect(text(await (back as () => Promise<PutBack>)())).toBe(`Back on ${head.slice(0, 12)}.`);
    expect(app.run("rev-parse", "HEAD")).toBe(head);
    expect(app.branch()).toBe("");
  });

  test("a branch origin does not have is not fetched, and nothing changes", async () => {
    const app = clone();
    app.write("README.md", "mine\n");
    const { said, back } = await checkOut(app.path, "feature/gone");
    expect(back).toBeNull();
    expect(said).toHaveLength(1);
    expect(said[0]).toStartWith(
      "! Could not fetch feature/gone, so what is checked out is reviewed:",
    );
    expect(app.read("README.md")).toBe("mine\n");
    expect(app.run("stash", "list")).toBe("");

    const stopped = new AbortController();
    stopped.abort();
    const cancelled = await checkOut(app.path, "feature/MOB-1", stopped.signal);
    expect(cancelled.back).toBeNull();
    expect(cancelled.said[0]).toStartWith("! Could not fetch feature/MOB-1");
  });

  test("a branch that cannot be checked out leaves your changes as they were", async () => {
    const app = clone();
    const elsewhere = makeTempDir("xuefu-worktree-");
    cleanups.push(elsewhere.cleanup);
    app.run("fetch", "-q", "origin", "feature/MOB-1:feature/MOB-1");
    // A branch checked out in another worktree cannot be checked out here too.
    app.run("worktree", "add", "-q", join(elsewhere.path, "wt"), "feature/MOB-1");
    app.write("README.md", "mine\n");
    const { said, back } = await checkOut(app.path);
    expect(back).toBeNull();
    expect(said[1]).toStartWith("! Could not check out feature/MOB-1:");
    expect(said[2]).toBe("Your uncommitted changes are back as they were.");
    expect(app.branch()).toBe("main");
    expect(app.read("README.md")).toBe("mine\n");
  });

  test("outside a repository it says so and does nothing", async () => {
    const dir = makeTempDir("xuefu-plain-");
    cleanups.push(dir.cleanup);
    const { said, back } = await checkOut(dir.path as AbsolutePath);
    expect(back).toBeNull();
    expect(said[0]).toStartWith("! Could not read what is checked out:");
  });
});
