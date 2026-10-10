import type { ProcessFailure } from "../../../application/ports/process-runner";
import type { ProcessError, ValidationError } from "../../../domain/shared/errors";
import type { AbsolutePath } from "../../../domain/shared/path";
import type { Result } from "../../../domain/shared/result";
import type { CommitMessage } from "../domain/commit";
import type { GitStatus } from "../domain/status";

type GitFailure = ProcessFailure | ProcessError | ValidationError;

/** Files to stage or unstage: paths relative to the repository's top, as status names them. */
export type GitFiles = "all" | readonly string[];

/** The git operations XueFu uses, on the repository at a folder. */
export interface GitClient {
  /** The repository's status; null when the folder is not in a git repository. */
  status(folder: AbsolutePath, signal?: AbortSignal): Promise<Result<GitStatus | null, GitFailure>>;
  /** Adds the files' changes to the index, deletions included. */
  stage(
    folder: AbsolutePath,
    files: GitFiles,
    signal?: AbortSignal,
  ): Promise<Result<void, GitFailure>>;
  /** Takes the files' changes back out of the index, leaving the working tree as it is. */
  unstage(
    folder: AbsolutePath,
    files: GitFiles,
    signal?: AbortSignal,
  ): Promise<Result<void, GitFailure>>;
  /** Commits what is staged, running the repository's hooks; resolves to the new commit's id. */
  commit(
    folder: AbsolutePath,
    message: CommitMessage,
    signal?: AbortSignal,
  ): Promise<Result<string, GitFailure>>;
}
