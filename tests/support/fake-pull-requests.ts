import { notFound } from "../../src/domain/shared/errors";
import { err, ok } from "../../src/domain/shared/result";
import { type PrChanges, prActions } from "../../src/plugins/pr/application/actions";
import type { Checkout, CheckoutReader } from "../../src/plugins/pr/application/checkout";
import type {
  PullRequestClient,
  PullRequestPage,
} from "../../src/plugins/pr/application/pull-request-client";
import {
  type BuildSummary,
  type PullRequest,
  pullRequestRef,
  type Repository,
} from "../../src/plugins/pr/domain/pull-request";
import { pluginContext } from "./plugin-context";

/** An open pull request on MOB/mobile-banking, with what is not given filled in. */
export const pullRequest = (id: number, extra: Partial<PullRequest> = {}): PullRequest => ({
  repository: { project: "MOB", slug: "mobile-banking" },
  id,
  version: 0,
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

/** What every pull request in a fake server changes: a line in one file, and a new file. */
export const sampleDiff = (pull: Pick<PullRequest, "id">): string =>
  [
    "diff --git a/app/src/Login.kt b/app/src/Login.kt",
    "index 3b18e51..a2c4f0d 100644",
    "--- a/app/src/Login.kt",
    "+++ b/app/src/Login.kt",
    "@@ -10,3 +10,4 @@ class Login {",
    "     fun start() {",
    "-        pin()",
    `+        if (biometrics) prompt(${pull.id})`,
    "+        else pin()",
    "     }",
    "diff --git a/docs/login.md b/docs/login.md",
    "new file mode 100644",
    "--- /dev/null",
    "+++ b/docs/login.md",
    "@@ -0,0 +1,2 @@",
    "+# Login",
    "+Face ID first, then the PIN.",
    "",
  ].join("\n");

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
  const find = (repository: Repository, id: number) => {
    const found = [...yours, ...toReview].find(
      (pull) => pullRequestRef(pull) === pullRequestRef({ repository, id }),
    );
    return found === undefined
      ? err(notFound("pull request", pullRequestRef({ repository, id })))
      : ok(found);
  };
  return {
    mine: (role, max) => Promise.resolve(ok(page(role === "author" ? yours : toReview, max))),
    pullRequest: (repository, id) => Promise.resolve(find(repository, id)),
    forBranch: (repository, branch) =>
      Promise.resolve(
        ok(
          [...yours, ...toReview].find(
            (pull) =>
              pull.from === branch &&
              pull.repository.project === repository.project &&
              pull.repository.slug === repository.slug,
          ) ?? null,
        ),
      ),
    review: () => Promise.resolve(ok(undefined)),
    mergeability: () => Promise.resolve(ok({ canMerge: true, conflicted: false, vetoes: [] })),
    merge: (repository, id) => {
      const found = find(repository, id);
      return Promise.resolve(found.ok ? ok({ ...found.value, state: "merged" as const }) : found);
    },
    diff: (repository, id) => {
      const found = find(repository, id);
      return Promise.resolve(found.ok ? ok(sampleDiff(found.value)) : found);
    },
    builds: () => Promise.resolve(ok(builds)),
    ...overrides,
  };
}

/** Every folder has `checkout`, by default a branch on MOB/mobile-banking. */
function fakeCheckouts(
  checkout: Checkout | null = {
    branch: "feature/MOB-2841-biometric-login",
    origin: "ssh://git@bitbucket.example.com:7999/mob/mobile-banking.git",
  },
): CheckoutReader {
  return { read: () => Promise.resolve(ok(checkout)) };
}

/** The plugin's changes over `client`, its actions on a real bus, reading `checkouts`. */
export function prChanges(
  client: PullRequestClient,
  checkouts: CheckoutReader = fakeCheckouts(),
): PrChanges {
  const { bus } = pluginContext();
  const actions = prActions(client);
  bus.register(actions.review);
  bus.register(actions.merge);
  return {
    client,
    checkouts,
    host: "bitbucket.example.com",
    invoke: (command, input, options) => bus.invoke(command, input, options),
    actions,
  };
}
