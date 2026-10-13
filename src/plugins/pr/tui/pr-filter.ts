import { type PullRequest, pullRequestRef, reviewFreshness } from "../domain/pull-request";
import type { PrLists } from "./pr-rows";

export const PR_FILTERS = ["all", "to-review", "needs-work", "outdated"] as const;
export type PrFilter = (typeof PR_FILTERS)[number];
export const FILTER_LABELS: Record<PrFilter, string> = {
  all: "All",
  "to-review": "To review",
  "needs-work": "Needs work",
  outdated: "Outdated reviews",
};

export function filterPrLists(lists: PrLists, query: string, filter: PrFilter): PrLists {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/u).filter(Boolean);
  const matches = (pull: PullRequest) => {
    const text = `${pullRequestRef(pull)} ${pull.title} ${pull.author}`.toLocaleLowerCase();
    return (
      terms.every((term) => text.includes(term)) &&
      (filter !== "needs-work" ||
        pull.reviewers.some((reviewer) => reviewer.status === "needs-work")) &&
      (filter !== "outdated" ||
        pull.reviewers.some((reviewer) => reviewFreshness(reviewer, pull.commit) === "outdated"))
    );
  };
  return {
    branch:
      filter === "to-review"
        ? null
        : typeof lists.branch === "object" && lists.branch !== null
          ? matches(lists.branch)
            ? lists.branch
            : null
          : lists.branch,
    yours:
      filter === "to-review"
        ? lists.yours === null
          ? null
          : []
        : (lists.yours?.filter(matches) ?? null),
    toReview: lists.toReview?.filter(matches) ?? null,
  };
}
