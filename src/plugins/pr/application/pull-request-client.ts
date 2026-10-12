import type { HttpFailure } from "../../../application/ports/http-client";
import type { SecretFailure } from "../../../application/ports/secret-provider";
import type { ConfigurationError, NotFoundError, RemoteError } from "../../../domain/shared/errors";
import type { Result } from "../../../domain/shared/result";
import type { CommentDraft, PullRequestComment } from "../domain/comment";
import type { BuildSummary, PullRequest, Repository, ReviewStatus } from "../domain/pull-request";

export type PullRequestFailure =
  | HttpFailure
  | SecretFailure
  | RemoteError
  | NotFoundError
  | ConfigurationError;

/** Open pull requests, up to as many as were asked for, and whether there are more. */
export interface PullRequestPage {
  readonly pullRequests: PullRequest[];
  readonly more: boolean;
}

/** What XueFu reads from the server that hosts pull requests, and the changes it makes there. */
export interface PullRequestClient {
  /** Open pull requests you wrote, or that ask for your review, newest first. */
  mine(
    role: "author" | "reviewer",
    max: number,
    signal?: AbortSignal,
  ): Promise<Result<PullRequestPage, PullRequestFailure>>;
  pullRequest(
    repository: Repository,
    id: number,
    signal?: AbortSignal,
  ): Promise<Result<PullRequest, PullRequestFailure>>;
  /** The open pull request from a branch of the repository; null when there is none. */
  forBranch(
    repository: Repository,
    branch: string,
    signal?: AbortSignal,
  ): Promise<Result<PullRequest | null, PullRequestFailure>>;
  /**
   * Sets your review: approved, asking for changes, or neither. It is of `commit`, the one that was
   * looked at, so a branch that has moved since is refused.
   */
  review(
    repository: Repository,
    id: number,
    status: ReviewStatus,
    commit: string,
    signal?: AbortSignal,
  ): Promise<Result<void, PullRequestFailure>>;
  /** Whether it can be merged now, and if not, why not. */
  mergeability(
    repository: Repository,
    id: number,
    signal?: AbortSignal,
  ): Promise<Result<Mergeability, PullRequestFailure>>;
  /**
   * Merges it as the repository merges by default. It is of `version`, the one that was read, so a
   * pull request that has changed since is refused.
   */
  merge(
    repository: Repository,
    id: number,
    version: number,
    signal?: AbortSignal,
  ): Promise<Result<PullRequest, PullRequestFailure>>;
  /** What it changes, as a unified diff with git's headings. */
  diff(
    repository: Repository,
    id: number,
    signal?: AbortSignal,
  ): Promise<Result<string, PullRequestFailure>>;
  /** Its comment threads, oldest first, each with its replies. */
  comments(
    repository: Repository,
    id: number,
    signal?: AbortSignal,
  ): Promise<Result<PullRequestComment[], PullRequestFailure>>;
  /** Posts a comment: on the pull request, on a line of its diff, or in reply to another. */
  comment(
    repository: Repository,
    id: number,
    draft: CommentDraft,
    signal?: AbortSignal,
  ): Promise<Result<PullRequestComment, PullRequestFailure>>;
  /** Builds reported for a commit. */
  builds(commit: string, signal?: AbortSignal): Promise<Result<BuildSummary, PullRequestFailure>>;
}

export interface Mergeability {
  readonly canMerge: boolean;
  /** Whether merging would conflict. */
  readonly conflicted: boolean;
  /** What the repository's merge checks say stands in the way, such as approvals still wanted. */
  readonly vetoes: readonly string[];
}
