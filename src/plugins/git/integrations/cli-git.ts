import type { ProcessOutput, ProcessRunner } from "../../../application/ports/process-runner";
import { processError } from "../../../domain/shared/errors";
import type { AbsolutePath } from "../../../domain/shared/path";
import { err, ok } from "../../../domain/shared/result";
import type { GitClient, GitFiles } from "../application/git-client";
import { parseStatus } from "../domain/status";

const STATUS_TIMEOUT_MS = 10_000;
const INDEX_TIMEOUT_MS = 30_000;
/** Commit hooks may lint and type-check the whole project. */
const COMMIT_TIMEOUT_MS = 5 * 60_000;
/** A status this long is a repository in trouble, not one worth listing. */
const MAX_STATUS_BYTES = 8 * 1024 * 1024;

const ENV = {
  // Never wait on a password prompt nobody can see.
  GIT_TERMINAL_PROMPT: "0",
  // Nor on an editor: every message is given on the command line.
  GIT_EDITOR: "true",
  // Messages in English, so "not a git repository" can be recognised.
  LC_ALL: "C",
};

const STATUS_ENV = {
  // Reading status must not take the index lock, or it would block the user's own git commands.
  GIT_OPTIONAL_LOCKS: "0",
  GIT_TERMINAL_PROMPT: "0",
  LC_ALL: "C",
};

const NOT_A_REPOSITORY = /not a git repository/i;

/**
 * Why git failed, in a line: its first fatal or error line, or else the last thing it said, which
 * is where a commit hook usually explains itself.
 */
function reason({ stderr, stdout }: ProcessOutput): string {
  const lines = (stderr.trim() === "" ? stdout : stderr)
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
  const fatal = lines.find((line) => /^(fatal|error): /.test(line));
  return (fatal ?? lines.at(-1) ?? "").replace(/^(fatal|error): /, "");
}

function failed(what: string, output: ProcessOutput) {
  const why = reason(output);
  return err(processError(`${what} failed${why === "" ? "" : `: ${why}`}`, "git", output.exitCode));
}

/**
 * Pathspecs for the files, read literally and from the repository's top, since that is how
 * status names them; "all" is the whole tree.
 */
const pathspecs = (files: GitFiles) =>
  files === "all" ? [":/"] : files.map((path) => `:(top,literal)${path}`);

/** Drives the installed git through its command line, reading only machine-readable output. */
export function cliGit(processes: ProcessRunner): GitClient {
  const run = (
    folder: AbsolutePath,
    args: readonly string[],
    timeoutMs: number,
    signal: AbortSignal | undefined,
  ) =>
    processes.run(
      { command: "git", args, cwd: folder, env: ENV },
      { timeoutMs, ...(signal === undefined ? {} : { signal }) },
    );

  /** Runs a command that changes the repository, failing on any non-zero exit. */
  const change = async (
    what: string,
    folder: AbsolutePath,
    args: readonly string[],
    timeoutMs: number,
    signal: AbortSignal | undefined,
  ) => {
    const ran = await run(folder, args, timeoutMs, signal);
    if (!ran.ok) return ran;
    return ran.value.exitCode === 0 ? ok(ran.value) : failed(what, ran.value);
  };

  return {
    async status(folder, signal) {
      const ran = await processes.run(
        {
          command: "git",
          args: ["status", "--porcelain=v2", "--branch", "--show-stash", "-z"],
          cwd: folder,
          env: STATUS_ENV,
        },
        {
          timeoutMs: STATUS_TIMEOUT_MS,
          maxOutputBytes: MAX_STATUS_BYTES,
          ...(signal === undefined ? {} : { signal }),
        },
      );
      if (!ran.ok) return ran;
      const { exitCode, stderr, stdout, truncated } = ran.value;
      if (exitCode !== 0) {
        if (NOT_A_REPOSITORY.test(stderr)) return ok(null);
        return failed("git status", ran.value);
      }
      if (truncated) {
        return err(
          processError("git status listed too many files to show", "git", exitCode, {
            hint: "Add build output and dependencies to .gitignore.",
          }),
        );
      }
      return parseStatus(stdout);
    },

    async stage(folder, files, signal) {
      const args = ["add", "--all", "--", ...pathspecs(files)];
      const staged = await change("git add", folder, args, INDEX_TIMEOUT_MS, signal);
      return staged.ok ? ok(undefined) : staged;
    },

    async unstage(folder, files, signal) {
      // Unlike restore --staged, reset also works before the first commit.
      const args = ["reset", "--quiet", "--", ...pathspecs(files)];
      const unstaged = await change("git reset", folder, args, INDEX_TIMEOUT_MS, signal);
      return unstaged.ok ? ok(undefined) : unstaged;
    },

    async commit(folder, message, signal) {
      // Joined to its flag, so a message starting with a dash is never read as an option.
      const args = ["commit", "--quiet", `--message=${message}`];
      const committed = await change("git commit", folder, args, COMMIT_TIMEOUT_MS, signal);
      if (!committed.ok) return committed;
      const head = await change(
        "git rev-parse",
        folder,
        ["rev-parse", "--verify", "HEAD"],
        STATUS_TIMEOUT_MS,
        signal,
      );
      return head.ok ? ok(head.value.stdout.trim()) : head;
    },
  };
}
