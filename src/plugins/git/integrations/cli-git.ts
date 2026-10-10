import type { ProcessRunner } from "../../../application/ports/process-runner";
import { processError } from "../../../domain/shared/errors";
import type { AbsolutePath } from "../../../domain/shared/path";
import { err, ok } from "../../../domain/shared/result";
import type { GitClient } from "../application/git-client";
import { parseStatus } from "../domain/status";

const STATUS_TIMEOUT_MS = 10_000;
/** A status this long is a repository in trouble, not one worth listing. */
const MAX_STATUS_BYTES = 8 * 1024 * 1024;

const ENV = {
  // Reading status must not take the index lock, or it would block the user's own git commands.
  GIT_OPTIONAL_LOCKS: "0",
  // Never wait on a password prompt nobody can see.
  GIT_TERMINAL_PROMPT: "0",
  // Messages in English, so "not a git repository" can be recognised.
  LC_ALL: "C",
};

const NOT_A_REPOSITORY = /not a git repository/i;

/** The first line git wrote to stderr, without its "fatal: " prefix. */
function reason(stderr: string): string {
  const line = stderr.split("\n").find((text) => text.trim() !== "") ?? "";
  return line.replace(/^(fatal|error): /, "").trim();
}

/** Drives the installed git through its command line, reading only machine-readable output. */
export function cliGit(processes: ProcessRunner): GitClient {
  return {
    async status(folder: AbsolutePath, signal?: AbortSignal) {
      const ran = await processes.run(
        {
          command: "git",
          args: ["status", "--porcelain=v2", "--branch", "--show-stash", "-z"],
          cwd: folder,
          env: ENV,
        },
        {
          timeoutMs: STATUS_TIMEOUT_MS,
          maxOutputBytes: MAX_STATUS_BYTES,
          ...(signal === undefined ? {} : { signal }),
        },
      );
      if (!ran.ok) return ran;
      const { exitCode, stdout, stderr, truncated } = ran.value;
      if (exitCode !== 0) {
        if (NOT_A_REPOSITORY.test(stderr)) return ok(null);
        const why = reason(stderr);
        return err(
          processError(`git status failed${why === "" ? "" : `: ${why}`}`, "git", exitCode),
        );
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
  };
}
