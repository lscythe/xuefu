import type { ProcessFailure } from "../../../application/ports/process-runner";
import type { ProcessError, ValidationError } from "../../../domain/shared/errors";
import type { AbsolutePath } from "../../../domain/shared/path";
import type { Result } from "../../../domain/shared/result";
import type { GitStatus } from "../domain/status";

type GitFailure = ProcessFailure | ProcessError | ValidationError;

/** The git operations XueFu uses, on the repository at a folder. */
export interface GitClient {
  /** The repository's status; null when the folder is not in a git repository. */
  status(folder: AbsolutePath, signal?: AbortSignal): Promise<Result<GitStatus | null, GitFailure>>;
}
