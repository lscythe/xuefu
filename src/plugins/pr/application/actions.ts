import { z } from "zod";
import { defineCommand } from "../../../application/commands/command";
import type { CommandBus } from "../../../application/commands/command-bus";
import { anchorText, type CommentDraft } from "../domain/comment";
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

  const comment = defineCommand({
    name: "pr.comment",
    title: "Comment on pull request",
    category: "Pull requests",
    safety: "confirm",
    input: z.strictObject({
      ...PullRequestInput,
      text: z.string().trim().min(1).max(32_000),
      /** The line it is on; null for the pull request as a whole, or a reply. */
      anchor: z
        .strictObject({
          path: z.string().min(1).max(4096),
          line: z.int().min(1).nullable(),
          side: z.enum(["old", "new"]),
          lineKind: z.enum(["added", "removed", "context"]).nullable(),
        })
        .nullable(),
      replyTo: z.int().min(1).nullable(),
    }),
    describe: (input) => {
      const ref = pullRequestRef({ repository: input, id: input.id });
      const on =
        input.replyTo !== null
          ? `a reply to #${input.replyTo}`
          : input.anchor === null
            ? "the pull request"
            : anchorText(input.anchor);
      return {
        title: input.replyTo === null ? `Comment on ${ref}` : `Reply on ${ref}`,
        severity: "confirm",
        details: [
          { label: "Pull request", value: ref },
          { label: "On", value: on },
          { label: "Comment", value: shortened(input.text) },
        ],
        consequence:
          "Posts it on Bitbucket under your name, where its author and reviewers will see it.",
        confirmLabel: "Post",
      };
    },
    handler: (input, context) =>
      client.comment(
        { project: input.project, slug: input.slug },
        input.id,
        { text: input.text, anchor: input.anchor, replyTo: input.replyTo },
        context.signal,
      ),
  });

  return { review, merge, comment };
}

/** A comment as a confirmation shows it: on one line, cut short when long. */
const shortened = (text: string) => {
  const line = text.trim().replace(/\s+/g, " ");
  return line.length > 200 ? `${line.slice(0, 199)}…` : line;
};

/** What `pr.comment` takes for a comment on a pull request. */
export function commentInput(pull: PullRequest, draft: CommentDraft) {
  return {
    project: pull.repository.project,
    slug: pull.repository.slug,
    id: pull.id,
    title: pull.title,
    text: draft.text,
    anchor: draft.anchor,
    replyTo: draft.replyTo,
  };
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
