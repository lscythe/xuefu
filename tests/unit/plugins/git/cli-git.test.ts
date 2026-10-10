import { describe, expect, test } from "bun:test";
import type {
  ProcessFailure,
  ProcessOptions,
  ProcessOutput,
  ProcessRunner,
  ProcessSpec,
} from "../../../../src/application/ports/process-runner";
import { processError } from "../../../../src/domain/shared/errors";
import type { AbsolutePath } from "../../../../src/domain/shared/path";
import { type Err, err, ok } from "../../../../src/domain/shared/result";
import type { BranchName } from "../../../../src/plugins/git/domain/branches";
import type { CommitMessage } from "../../../../src/plugins/git/domain/commit";
import { cliGit } from "../../../../src/plugins/git/integrations/cli-git";

const HERE = "/work/mobile" as AbsolutePath;

/** A runner that answers every call with `output`, remembering what it was asked. */
function fakeRunner(output: Partial<ProcessOutput> | Err<ProcessFailure>) {
  const calls: { spec: ProcessSpec; options: ProcessOptions }[] = [];
  const runner: ProcessRunner = {
    run: (spec, options) => {
      calls.push({ spec, options });
      if ("ok" in output) return Promise.resolve(output);
      return Promise.resolve(
        ok({ exitCode: 0, stdout: "", stderr: "", durationMs: 1, truncated: false, ...output }),
      );
    },
  };
  return { runner, calls };
}

describe("cliGit status", () => {
  test("runs porcelain v2 status in the folder, without taking locks or prompting", async () => {
    const { runner, calls } = fakeRunner({ stdout: "# branch.head main\0" });
    const signal = new AbortController().signal;
    const read = await cliGit(runner).status(HERE, signal);
    expect(read.ok && read.value?.branch).toBe("main");
    expect(calls[0]?.spec).toEqual({
      command: "git",
      args: ["status", "--porcelain=v2", "--branch", "--show-stash", "-z"],
      cwd: HERE,
      env: { GIT_OPTIONAL_LOCKS: "0", GIT_TERMINAL_PROMPT: "0", LC_ALL: "C" },
    });
    expect(calls[0]?.options.signal).toBe(signal);
  });

  test("output cut short is an error rather than a partial list", async () => {
    const { runner } = fakeRunner({ stdout: "# branch.head main\0", truncated: true });
    const read = await cliGit(runner).status(HERE);
    expect(!read.ok && read.error.message).toBe("git status listed too many files to show");
  });

  test("a failure without a message still says git status failed", async () => {
    const { runner } = fakeRunner({ exitCode: 1, stderr: "\n" });
    const read = await cliGit(runner).status(HERE);
    expect(!read.ok && read.error).toMatchObject({
      kind: "process",
      message: "git status failed",
      exitCode: 1,
    });
  });

  test("git missing, or the run stopped, passes through as it came", async () => {
    const missing = processError("Unable to run git", "git", null);
    const { runner } = fakeRunner(err(missing));
    expect(await cliGit(runner).status(HERE)).toEqual(err(missing));
  });
});

describe("cliGit stage and unstage", () => {
  test("names each file literally from the repository's top, since status does", async () => {
    const { runner, calls } = fakeRunner({});
    const signal = new AbortController().signal;
    expect(await cliGit(runner).stage(HERE, ["src/a file.ts", "*.md"], signal)).toEqual(
      ok(undefined),
    );
    expect(calls[0]?.spec.args).toEqual([
      "add",
      "--all",
      "--",
      ":(top,literal)src/a file.ts",
      ":(top,literal)*.md",
    ]);
    expect(calls[0]?.spec.env).toEqual({
      GIT_TERMINAL_PROMPT: "0",
      GIT_EDITOR: "true",
      LC_ALL: "C",
    });
    expect(calls[0]?.options.signal).toBe(signal);
  });

  test("all is the whole tree, wherever the workspace sits in it", async () => {
    const { runner, calls } = fakeRunner({});
    await cliGit(runner).stage(HERE, "all");
    await cliGit(runner).unstage(HERE, "all");
    expect(calls.map((call) => call.spec.args)).toEqual([
      ["add", "--all", "--", ":/"],
      ["reset", "--quiet", "--", ":/"],
    ]);
  });

  test("a refusal names what git said", async () => {
    const { runner } = fakeRunner({
      exitCode: 128,
      stderr: "warning: something odd\nfatal: Unable to create '.git/index.lock': File exists.\n",
    });
    const staged = await cliGit(runner).unstage(HERE, ["a.ts"]);
    expect(!staged.ok && staged.error).toMatchObject({
      kind: "process",
      message: "git reset failed: Unable to create '.git/index.lock': File exists.",
      exitCode: 128,
    });
  });
});

describe("cliGit commit", () => {
  test("commits with the message joined to its flag, then reads the new commit's id", async () => {
    const { runner, calls } = fakeRunner({ stdout: "1a2b3c4d\n" });
    const message = "-v is not a flag here" as CommitMessage;
    expect(await cliGit(runner).commit(HERE, message)).toEqual(ok("1a2b3c4d"));
    expect(calls.map((call) => call.spec.args)).toEqual([
      ["commit", "--quiet", "--message=-v is not a flag here"],
      ["rev-parse", "--verify", "HEAD"],
    ]);
    expect(calls[0]?.options.timeoutMs).toBe(300_000);
  });

  test("a hook's refusal is told by the last thing the hook said", async () => {
    const { runner, calls } = fakeRunner({
      exitCode: 1,
      stdout: "lint ❯\nsrc/a.ts: unused import\n✗ lint failed\n",
    });
    const made = await cliGit(runner).commit(HERE, "Fix" as CommitMessage);
    expect(!made.ok && made.error.message).toBe("git commit failed: ✗ lint failed");
    expect(calls).toHaveLength(1);
  });
});

describe("cliGit branches", () => {
  test("lists branches here and on remotes, the most recently committed to first", async () => {
    const { runner, calls } = fakeRunner({
      stdout: "refs/heads/main\0*\0\0\0\x001791622028\0Fix\n",
    });
    const listed = await cliGit(runner).branches(HERE);
    expect(listed.ok && listed.value.map((branch) => branch.name)).toEqual(["main"]);
    expect(calls[0]?.spec.args.slice(0, 2)).toEqual(["for-each-ref", "--sort=-committerdate"]);
    expect(calls[0]?.spec.args.slice(-2)).toEqual(["refs/heads", "refs/remotes"]);
  });

  test("creates, switches to and tracks branches", async () => {
    const { runner, calls } = fakeRunner({});
    const git = cliGit(runner);
    await git.createBranch(HERE, "feat" as BranchName, null);
    await git.createBranch(HERE, "fix" as BranchName, "origin/main" as BranchName);
    await git.switchBranch(HERE, "main" as BranchName, false);
    await git.switchBranch(HERE, "origin/feat" as BranchName, true);
    expect(calls.map((call) => call.spec.args)).toEqual([
      ["switch", "--create", "feat"],
      ["switch", "--create", "fix", "origin/main"],
      ["switch", "main"],
      ["switch", "--track", "origin/feat"],
    ]);
  });

  test("local changes in the way come with what to do about them", async () => {
    const { runner } = fakeRunner({
      exitCode: 1,
      stderr:
        "error: Your local changes to the following files would be overwritten by checkout:\n\ta.txt\n",
    });
    const switched = await cliGit(runner).switchBranch(HERE, "main" as BranchName, false);
    expect(!switched.ok && switched.error.hint).toBe("Commit or stash your changes first.");
  });

  test("an unmerged branch is kept, which is an answer rather than a failure", async () => {
    const unmerged = fakeRunner({
      exitCode: 1,
      stderr: "error: the branch 'feat' is not fully merged.\n",
    });
    expect(await cliGit(unmerged.runner).deleteBranch(HERE, "feat" as BranchName, false)).toEqual(
      ok(false),
    );
    const forced = fakeRunner({});
    expect(await cliGit(forced.runner).deleteBranch(HERE, "feat" as BranchName, true)).toEqual(
      ok(true),
    );
    expect(forced.calls[0]?.spec.args).toEqual(["branch", "--delete", "--force", "feat"]);
    const current = fakeRunner({ exitCode: 1, stderr: "error: cannot delete branch 'main'\n" });
    const refused = await cliGit(current.runner).deleteBranch(HERE, "main" as BranchName, false);
    expect(!refused.ok && refused.error.message).toBe(
      "git branch failed: cannot delete branch 'main'",
    );
  });
});
