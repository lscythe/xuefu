import type { HttpFailure } from "../../../application/ports/http-client";
import type { SecretFailure } from "../../../application/ports/secret-provider";
import type { ConfigurationError, NotFoundError, RemoteError } from "../../../domain/shared/errors";
import type { Result } from "../../../domain/shared/result";
import type { BuildSummary, PullRequest, Repository } from "../domain/pull-request";

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

/** What XueFu reads from the server that hosts pull requests. */
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
  /** Builds reported for a commit. */
  builds(commit: string, signal?: AbortSignal): Promise<Result<BuildSummary, PullRequestFailure>>;
}
