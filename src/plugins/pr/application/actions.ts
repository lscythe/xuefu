import { z } from "zod";
import { defineCommand } from "../../../application/commands/command";
import type { CommandBus } from "../../../application/commands/command-bus";
import { type PullRequest, pullRequestRef, type ReviewStatus } from "../domain/pull-request";
import type { BranchPullRequestDependencies } from "./branch-pull-request";
import type { PullRequestClient } from "./pull-request-client";

/** Names a pull request, with what a confirmation shows of it. */
const PullRequestInput = {
  project: z.string().min(1).max(128),
  slug: z.string().min(1).max(128),
  id: z.int().min(1),
  title: z.string().max(255),
};

const REVIEWS: Readonly<
  Record<ReviewStatus, { readonly verb: string; readonly label: string; readonly does: string }>
> = {
  approved: { verb: "Approve", label: "Approve", does: "Approves it" },
  "needs-work": {
    verb: "Ask for changes on",
    label: "Ask for changes",
    does: "Marks it as needing work",
  },
  unapproved: {
    verb: "Withdraw your review of",
    label: "Withdraw",
    does: "Takes back your approval, or your request for changes,",
  },
};

/** What `pr.review` takes for a pull request and how it is to be reviewed. */
export function reviewInput(pull: PullRequest, status: ReviewStatus) {
  return {
    project: pull.repository.project,
    slug: pull.repository.slug,
    id: pull.id,
    title: pull.title,
    commit: pull.commit,
    status,
  };
}

/** What the pull requests plugin changes on the server, as commands on the bus. */
export function prActions(client: PullRequestClient) {
  const review = defineCommand({
    name: "pr.review",
    title: "Review pull request",
    category: "Pull requests",
    safety: "confirm",
    input: z.strictObject({
      ...PullRequestInput,
      /** The latest commit when it was looked at; the review is of it. */
      commit: z.string().regex(/^[0-9a-f]{7,64}$/),
      status: z.enum(["approved", "needs-work", "unapproved"]),
    }),
    describe: (input) => {
      const ref = pullRequestRef({ repository: input, id: input.id });
      const said = REVIEWS[input.status];
      return {
        title: `${said.verb} ${ref}`,
        severity: "confirm",
        details: [
          { label: "Pull request", value: ref },
          { label: "Title", value: input.title },
          { label: "Commit", value: input.commit.slice(0, 11) },
        ],
        consequence: `${said.does} on Bitbucket, where its author and reviewers will see it.`,
        confirmLabel: said.label,
      };
    },
    handler: (input, context) =>
      client.review(
        { project: input.project, slug: input.slug },
        input.id,
        input.status,
        input.commit,
        context.signal,
      ),
  });

  const merge = defineCommand({
    name: "pr.merge",
    title: "Merge pull request",
    category: "Pull requests",
    safety: "confirm",
    input: z.strictObject({
      ...PullRequestInput,
      /** Its version when it was looked at; the merge is of it. */
      version: z.int().min(0),
      from: z.string().min(1).max(255),
      to: z.string().min(1).max(255),
    }),
    describe: (input) => {
      const ref = pullRequestRef({ repository: input, id: input.id });
      return {
        title: `Merge ${ref}`,
        severity: "confirm",
        details: [
          { label: "Pull request", value: ref },
          { label: "Title", value: input.title },
          { label: "Branches", value: `${input.from} → ${input.to}` },
        ],
        consequence: `Merges ${input.from} into ${input.to} on Bitbucket, for everyone; it is not undone by XueFu.`,
        confirmLabel: "Merge",
      };
    },
    handler: (input, context) =>
      client.merge(
        { project: input.project, slug: input.slug },
        input.id,
        input.version,
        context.signal,
      ),
  });

  return { review, merge };
}

/** What `pr.merge` takes for a pull request. */
export function mergeInput(pull: PullRequest) {
  return {
    project: pull.repository.project,
    slug: pull.repository.slug,
    id: pull.id,
    title: pull.title,
    version: pull.version,
    from: pull.from,
    to: pull.to,
  };
}

type PrActions = ReturnType<typeof prActions>;

/** What the plugin reads, and how it changes pull requests: through the bus, asking first. */
export interface PrChanges extends BranchPullRequestDependencies {
  readonly invoke: CommandBus["invoke"];
  readonly actions: PrActions;
}
