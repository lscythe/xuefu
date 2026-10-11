import type { AppError } from "../../../application/errors";
import type { AbsolutePath } from "../../../domain/shared/path";
import { ok, type Result } from "../../../domain/shared/result";
import { type PullRequest, type Repository, repositoryFromRemote } from "../domain/pull-request";
import type { CheckoutReader } from "./checkout";
import type { PullRequestClient } from "./pull-request-client";

/** The pull request from a workspace's branch, or why there is none to show. */
export type BranchPullRequest =
  | { readonly kind: "not-a-repository" }
  /** No origin, or one on another server. */
  | { readonly kind: "elsewhere"; readonly origin: string | null }
  | { readonly kind: "detached"; readonly repository: Repository }
  | { readonly kind: "none"; readonly repository: Repository; readonly branch: string }
  | {
      readonly kind: "found";
      readonly repository: Repository;
      readonly branch: string;
      readonly pullRequest: PullRequest;
    };

export interface BranchPullRequestDependencies {
  readonly client: PullRequestClient;
  readonly checkouts: CheckoutReader;
  /** The host the server is on, as in its address. */
  readonly host: string;
}

/** Finds the open pull request from the branch checked out in `folder`. */
export async function branchPullRequest(
  deps: BranchPullRequestDependencies,
  folder: AbsolutePath,
  signal?: AbortSignal,
): Promise<Result<BranchPullRequest, AppError>> {
  const checkout = await deps.checkouts.read(folder, signal);
  if (!checkout.ok) return checkout;
  if (checkout.value === null) return ok({ kind: "not-a-repository" });
  const { branch, origin } = checkout.value;
  const repository = origin === null ? null : repositoryFromRemote(origin, deps.host);
  if (repository === null) return ok({ kind: "elsewhere", origin });
  if (branch === null) return ok({ kind: "detached", repository });
  const found = await deps.client.forBranch(repository, branch, signal);
  if (!found.ok) return found;
  return ok(
    found.value === null
      ? { kind: "none", repository, branch }
      : { kind: "found", repository, branch, pullRequest: found.value },
  );
}
