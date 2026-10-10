import type { ProcessFailure } from "../../../application/ports/process-runner";
import type { ProcessError, ValidationError } from "../../../domain/shared/errors";
import type { AbsolutePath } from "../../../domain/shared/path";
import type { Result } from "../../../domain/shared/result";
import type { Branch, BranchName } from "../domain/branches";
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
  /** Every branch here and on the remotes, the most recently committed to first. */
  branches(folder: AbsolutePath, signal?: AbortSignal): Promise<Result<Branch[], GitFailure>>;
  /** Makes a branch at `start`, or at HEAD when null, and switches to it. */
  createBranch(
    folder: AbsolutePath,
    name: BranchName,
    start: BranchName | null,
    signal?: AbortSignal,
  ): Promise<Result<void, GitFailure>>;
  /**
   * Switches to a branch; with `track`, `name` is a remote's branch, and a local branch tracking
   * it is made to switch to.
   */
  switchBranch(
    folder: AbsolutePath,
    name: BranchName,
    track: boolean,
    signal?: AbortSignal,
  ): Promise<Result<void, GitFailure>>;
  /**
   * Deletes a local branch. Unless forced, git keeps one whose commits are not merged: that
   * resolves to false rather than failing, so the caller can offer to force it.
   */
  deleteBranch(
    folder: AbsolutePath,
    name: BranchName,
    force: boolean,
    signal?: AbortSignal,
  ): Promise<Result<boolean, GitFailure>>;
  /** The repository's remotes, by name. */
  remotes(folder: AbsolutePath, signal?: AbortSignal): Promise<Result<string[], GitFailure>>;
  /** Updates what is known of the remotes' branches, changing nothing here. */
  fetch(folder: AbsolutePath, signal?: AbortSignal): Promise<Result<void, GitFailure>>;
  /** Brings in the upstream's commits, merging or rebasing as the user's git config says. */
  pull(folder: AbsolutePath, signal?: AbortSignal): Promise<Result<void, GitFailure>>;
  /**
   * Sends the current branch's commits to its upstream; with `publish`, first makes the branch
   * on that remote and tracks it.
   */
  push(
    folder: AbsolutePath,
    publish: { readonly remote: string; readonly branch: BranchName } | null,
    signal?: AbortSignal,
  ): Promise<Result<void, GitFailure>>;
  /** Commits what is staged, running the repository's hooks; resolves to the new commit's id. */
  commit(
    folder: AbsolutePath,
    message: CommitMessage,
    signal?: AbortSignal,
  ): Promise<Result<string, GitFailure>>;
}
