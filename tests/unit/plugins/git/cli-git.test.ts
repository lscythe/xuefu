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
