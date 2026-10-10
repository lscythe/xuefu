import { notFound } from "../../src/domain/shared/errors";
import { err, ok } from "../../src/domain/shared/result";
import type {
  PullRequestClient,
  PullRequestPage,
} from "../../src/plugins/pr/application/pull-request-client";
import {
  type BuildSummary,
  type PullRequest,
  pullRequestRef,
} from "../../src/plugins/pr/domain/pull-request";

/** An open pull request on MOB/mobile-banking, with what is not given filled in. */
export const pullRequest = (id: number, extra: Partial<PullRequest> = {}): PullRequest => ({
  repository: { project: "MOB", slug: "mobile-banking" },
  id,
  title: `Change ${id}`,
  description: null,
  state: "open",
  from: `feature/change-${id}`,
  to: "main",
  commit: `c0ffee${id}`,
  author: "Dana Scully",
  reviewers: [{ name: "Fox Mulder", status: "unapproved" }],
  created: Date.UTC(2026, 9, 5, 9, 0),
  updated: Date.UTC(2026, 9, 6, 13, 59),
  comments: 0,
  openTodos: 0,
  conflicted: false,
  url: `https://bitbucket.example.com/projects/MOB/repos/mobile-banking/pull-requests/${id}`,
  ...extra,
});

/**
 * A server with `yours` and `toReview` open, finding each by its ref, with every commit's builds
 * as `builds`.
 */
export function fakePullRequests(
  lists: { readonly yours?: PullRequest[]; readonly toReview?: PullRequest[] } = {},
  builds: BuildSummary = { successful: 1, failed: 0, inProgress: 0 },
  overrides: Partial<PullRequestClient> = {},
): PullRequestClient {
  const yours = lists.yours ?? [];
  const toReview = lists.toReview ?? [];
  const page = (pulls: PullRequest[], max: number): PullRequestPage => ({
    pullRequests: pulls.slice(0, max),
    more: pulls.length > max,
  });
  return {
    mine: (role, max) => Promise.resolve(ok(page(role === "author" ? yours : toReview, max))),
    pullRequest: (repository, id) => {
      const found = [...yours, ...toReview].find(
        (pull) => pullRequestRef(pull) === pullRequestRef({ repository, id }),
      );
      return Promise.resolve(
        found === undefined
          ? err(notFound("pull request", pullRequestRef({ repository, id })))
          : ok(found),
      );
    },
    builds: () => Promise.resolve(ok(builds)),
    ...overrides,
  };
}
