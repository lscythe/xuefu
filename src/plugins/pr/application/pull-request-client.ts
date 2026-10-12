import type { HttpFailure } from "../../../application/ports/http-client";
import type { SecretFailure } from "../../../application/ports/secret-provider";
import type { ConfigurationError, NotFoundError, RemoteError } from "../../../domain/shared/errors";
import type { Result } from "../../../domain/shared/result";
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
  /** Builds reported for a commit. */
  builds(commit: string, signal?: AbortSignal): Promise<Result<BuildSummary, PullRequestFailure>>;
}
