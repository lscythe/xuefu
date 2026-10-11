import type { AppError } from "../../../application/errors";
import { assertNever } from "../../../domain/shared/assert-never";
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

/** Why a workspace's branch has no pull request to show, as "HEAD is detached in Mobile". */
export function whyNoPullRequest(
  found: Exclude<BranchPullRequest, { kind: "found" }>,
  workspace: string,
  host: string,
): string {
  switch (found.kind) {
    case "not-a-repository":
      return `${workspace} is not a git repository`;
    case "elsewhere":
      return found.origin === null
        ? `${workspace} has no origin remote`
        : `${workspace}'s origin is not on ${host}`;
    case "detached":
      return `HEAD is detached in ${workspace}`;
    case "none":
      return `No open pull request from ${found.branch} in ${found.repository.project}/${found.repository.slug}`;
    default:
      return assertNever(found);
  }
}
