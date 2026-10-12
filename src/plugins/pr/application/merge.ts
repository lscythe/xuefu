import type { AppError } from "../../../application/errors";
import { conflict } from "../../../domain/shared/errors";
import { err, ok, type Result } from "../../../domain/shared/result";
import { type PullRequest, pullRequestRef } from "../domain/pull-request";
import type { PullRequestClient } from "./pull-request-client";

/**
 * Asks the server whether the pull request can be merged now, so nothing is offered that it would
 * refuse. Fails when it cannot, saying why: conflicts, or what the merge checks want first.
 */
export async function readyToMerge(
  client: PullRequestClient,
  pull: PullRequest,
  signal?: AbortSignal,
): Promise<Result<void, AppError>> {
  const ref = pullRequestRef(pull);
  if (pull.state !== "open") {
    return err(conflict(`${ref} is ${pull.state}`, "pull request", ref));
  }
  const checked = await client.mergeability(pull.repository, pull.id, signal);
  if (!checked.ok) return checked;
  const { canMerge, conflicted, vetoes } = checked.value;
  if (canMerge) return ok(undefined);
  const reasons = [
    ...(conflicted
      ? [`it conflicts with ${pull.to}; merge ${pull.to} into ${pull.from} first`]
      : []),
    ...vetoes,
  ];
  return err(
    conflict(`${ref} cannot be merged yet`, "pull request", ref, {
      hint: reasons.length === 0 ? "Bitbucket did not say why." : `${reasons.join("; ")}.`,
    }),
  );
}
