import { confirmationTokenFor } from "../../../application/commands/command";
import type { DispatchOptions } from "../../../application/commands/command-bus";
import type { AppError } from "../../../application/errors";
import { table } from "../../../cli/format";
import type {
  PluginCommandRunner,
  PluginCommandSpec,
  PluginInvocation,
} from "../../../cli/plugin-command";
import { ok, type Result } from "../../../domain/shared/result";
import type { Timestamp } from "../../../domain/shared/time";
import { wallClock } from "../../../domain/shared/wall-clock";
import { mergeInput, type PrChanges, reviewInput } from "../application/actions";
import {
  type BranchPullRequestDependencies,
  branchPullRequest,
  whyNoPullRequest,
} from "../application/branch-pull-request";
import { readyToMerge } from "../application/merge";
import { parseDiff } from "../domain/diff";
import {
  type BuildSummary,
  type PullRequest,
  parsePullRequestRef,
  pullRequestRef,
  type ReviewStatus,
  reviewSummary,
} from "../domain/pull-request";
import { commentJson, formatThreads } from "./comment-format";
import { diffStat } from "./diff-stat";

const json = { type: "boolean", description: "machine-readable output" } as const;
const workspace = {
  type: "string",
  short: "w",
  value: "<id>",
  description: "another workspace than this folder's",
} as const;
const yes = { type: "boolean", short: "y", description: "confirm without asking" } as const;

/** A command that changes a pull request: by default this branch's, asking first. */
const change = (name: string, summary: string): PluginCommandSpec => ({
  group: "pr",
  name,
  usage: "[PROJECT/repository#id]",
  minArgs: 0,
  maxArgs: 1,
  flags: { workspace, yes },
  summary,
});

export const PR_COMMANDS: readonly PluginCommandSpec[] = [
  {
    group: "pr",
    name: "list",
    isDefault: true,
    usage: "",
    minArgs: 0,
    maxArgs: 0,
    flags: { json },
    summary: "List open pull requests you wrote, and those waiting on your review",
  },
  {
    group: "pr",
    name: "show",
    usage: "[PROJECT/repository#id]",
    minArgs: 0,
    maxArgs: 1,
    flags: { workspace, json },
    summary: "Show a pull request, by default this branch's, with its reviews and builds",
  },
  {
    group: "pr",
    name: "diff",
    usage: "[PROJECT/repository#id]",
    minArgs: 0,
    maxArgs: 1,
    flags: {
      workspace,
      stat: {
        type: "boolean",
        description: "only the files changed, with lines added and removed",
      },
    },
    summary: "Show what a pull request changes, as a unified diff",
  },
  {
    group: "pr",
    name: "comments",
    usage: "[PROJECT/repository#id]",
    minArgs: 0,
    maxArgs: 1,
    flags: { workspace, json },
    summary: "Show a pull request's comment threads, with where each is in the diff",
  },
  change("approve", "Approve a pull request"),
  change("needs-work", "Ask for changes on a pull request"),
  change("unapprove", "Withdraw your approval of, or request for changes on, a pull request"),
  change("merge", "Merge a pull request, once Bitbucket says it can be"),
];

const REVIEWED: Readonly<Record<string, readonly [ReviewStatus, string]>> = {
  approve: ["approved", "Approved"],
  "needs-work": ["needs-work", "Asked for changes on"],
  unapprove: ["unapproved", "Withdrew your review of"],
};

const when = (at: number) => {
  const clock = wallClock(at as Timestamp);
  return `${clock.date} ${clock.time}`;
};

/** "1/2 approved", or "needs work" once a reviewer asks for changes. */
export function reviewsText(pull: Pick<PullRequest, "reviewers">): string {
  const { approved, reviewers, needsWork } = reviewSummary(pull);
  if (needsWork > 0) return "needs work";
  return reviewers === 0 ? "no reviewers" : `${approved}/${reviewers} approved`;
}

/** "2 passed, 1 failed, 1 running", or "none" when nothing has reported. */
export function buildsText(builds: BuildSummary): string {
  const parts = [
    builds.successful > 0 ? `${builds.successful} passed` : null,
    builds.failed > 0 ? `${builds.failed} failed` : null,
    builds.inProgress > 0 ? `${builds.inProgress} running` : null,
  ].filter((part) => part !== null);
  return parts.length === 0 ? "none" : parts.join(", ");
}

const pullJson = (pull: PullRequest) => ({
  ...pull,
  ref: pullRequestRef(pull),
  created: new Date(pull.created).toISOString(),
  updated: new Date(pull.updated).toISOString(),
});

function formatPullRequest(pull: PullRequest, builds: Result<BuildSummary, AppError>): string {
  const reviewers = pull.reviewers.map((reviewer) =>
    reviewer.status === "unapproved"
      ? reviewer.name
      : `${reviewer.name} (${reviewer.status.replace("-", " ")})`,
  );
  const details: [string, string][] = [
    ["State", pull.state[0]?.toUpperCase() + pull.state.slice(1)],
    ["Branches", `${pull.from} → ${pull.to}`],
    ["Author", pull.author],
    ["Reviewers", reviewers.length === 0 ? "none" : reviewers.join(", ")],
    ["Builds", builds.ok ? buildsText(builds.value) : `could not be read: ${builds.error.message}`],
    [
      "Comments",
      pull.openTodos === 0 ? String(pull.comments) : `${pull.comments}, ${pull.openTodos} to do`,
    ],
    ...(pull.conflicted === null
      ? []
      : [["Merge", pull.conflicted ? "conflicts" : "clean"] as [string, string]]),
    ["Updated", when(pull.updated)],
  ];
  const description = pull.description?.trim() ?? "";
  return [
    `${pullRequestRef(pull)}  ${pull.title}`,
    table(details.map(([label, value]) => [`  ${label}`, value])).trimEnd(),
    `  ${pull.url}`,
    ...(description === "" ? [] : ["", description]),
    "",
  ].join("\n");
}

/**
 * The pull request a command names, or else the one from the workspace's branch. Null when the
 * branch has none, once it is said why and what to do instead.
 */
async function pullRequestFor(
  deps: BranchPullRequestDependencies,
  invocation: PluginInvocation,
  io: Parameters<PluginCommandRunner>[1],
): Promise<Result<PullRequest | null, AppError>> {
  const raw = invocation.args[0];
  if (raw !== undefined) {
    const ref = parsePullRequestRef(raw);
    return ref.ok ? deps.client.pullRequest(ref.value.repository, ref.value.id) : ref;
  }
  const id = invocation.flags["workspace"];
  const workspace = await io.workspace(typeof id === "string" ? id : null);
  if (!workspace.ok) return workspace;
  const branch = await branchPullRequest(deps, workspace.value.path);
  if (!branch.ok) return branch;
  if (branch.value.kind === "found") return ok(branch.value.pullRequest);
  const why = whyNoPullRequest(branch.value, workspace.value.name, deps.host);
  const name = "name one, as PROJECT/repository#42";
  const fix =
    branch.value.kind === "none"
      ? ""
      : branch.value.kind === "detached"
        ? `; switch to a branch, or ${name}`
        : `; ${name}`;
  io.stderr(`${why}${fix}.\n`);
  return ok(null);
}

/**
 * Runs a command that asks first: run again approved with --yes, or else refused with its prompt,
 * which the CLI prints with how to approve it.
 */
async function confirmed<Output>(
  invoke: (options?: DispatchOptions) => Promise<Result<Output, AppError>>,
  invocation: PluginInvocation,
): Promise<Result<Output, AppError>> {
  const asked = await invoke();
  return !asked.ok &&
    asked.error.kind === "confirmation-required" &&
    invocation.flags["yes"] === true
    ? invoke({ confirmation: confirmationTokenFor(asked.error) })
    : asked;
}

/**
 * Runs `xuefu pr list` and `show`, which exit 1 when there is nothing to show, and the commands
 * that change a pull request, which ask first.
 */
export function prCommands(changes: PrChanges, maxResults: number): PluginCommandRunner {
  const { client, invoke, actions } = changes;
  return async (invocation, io) => {
    const asJson = invocation.flags["json"] === true;
    const reviewed = REVIEWED[invocation.name];
    if (reviewed !== undefined) {
      const found = await pullRequestFor(changes, invocation, io);
      if (!found.ok || found.value === null) return found.ok ? ok(1) : found;
      const pull = found.value;
      const [status, done] = reviewed;
      const sent = await confirmed(
        (options) => invoke(actions.review, reviewInput(pull, status), options),
        invocation,
      );
      if (!sent.ok) return sent;
      io.stdout(`✓ ${done} ${pullRequestRef(pull)} (${pull.title})\n`);
      return ok(0);
    }
    if (invocation.name === "merge") {
      const found = await pullRequestFor(changes, invocation, io);
      if (!found.ok || found.value === null) return found.ok ? ok(1) : found;
      const pull = found.value;
      const ready = await readyToMerge(client, pull);
      if (!ready.ok) return ready;
      const merged = await confirmed(
        (options) => invoke(actions.merge, mergeInput(pull), options),
        invocation,
      );
      if (!merged.ok) return merged;
      io.stdout(`✓ Merged ${pullRequestRef(pull)} (${pull.title}) into ${pull.to}\n`);
      return ok(0);
    }
    if (invocation.name === "comments") {
      const found = await pullRequestFor(changes, invocation, io);
      if (!found.ok || found.value === null) return found.ok ? ok(1) : found;
      const threads = await client.comments(found.value.repository, found.value.id);
      if (!threads.ok) return threads;
      if (asJson) {
        io.stdout(`${JSON.stringify(threads.value.map(commentJson), null, 2)}\n`);
        return ok(threads.value.length === 0 ? 1 : 0);
      }
      if (threads.value.length === 0) {
        io.stderr(`No comments on ${pullRequestRef(found.value)}.\n`);
        return ok(1);
      }
      io.stdout(formatThreads(threads.value, when));
      return ok(0);
    }
    if (invocation.name === "diff") {
      const found = await pullRequestFor(changes, invocation, io);
      if (!found.ok || found.value === null) return found.ok ? ok(1) : found;
      const diff = await client.diff(found.value.repository, found.value.id);
      if (!diff.ok) return diff;
      io.stdout(invocation.flags["stat"] === true ? diffStat(parseDiff(diff.value)) : diff.value);
      return ok(0);
    }
    if (invocation.name === "show") {
      const read = await pullRequestFor(changes, invocation, io);
      if (!read.ok || read.value === null) return read.ok ? ok(1) : read;
      const found = read.value;
      const builds = await client.builds(found.commit);
      io.stdout(
        asJson
          ? `${JSON.stringify({ ...pullJson(found), builds: builds.ok ? builds.value : null }, null, 2)}\n`
          : formatPullRequest(found, builds),
      );
      return ok(0);
    }

    const [yours, reviewing] = await Promise.all([
      client.mine("author", maxResults),
      client.mine("reviewer", maxResults),
    ]);
    if (!yours.ok) return yours;
    if (!reviewing.ok) return reviewing;
    const none = yours.value.pullRequests.length === 0 && reviewing.value.pullRequests.length === 0;
    if (asJson) {
      io.stdout(
        `${JSON.stringify(
          {
            yours: yours.value.pullRequests.map(pullJson),
            toReview: reviewing.value.pullRequests.map(pullJson),
          },
          null,
          2,
        )}\n`,
      );
      return ok(none ? 1 : 0);
    }
    if (none) {
      io.stderr("No open pull requests are yours or wait on your review.\n");
      return ok(1);
    }
    const rows = (pulls: readonly PullRequest[]) =>
      pulls.map((pull) => [
        `  ${pullRequestRef(pull)}`,
        reviewsText(pull),
        when(pull.updated),
        pull.title,
      ]);
    const groups: [string, readonly PullRequest[], boolean][] = [
      ["Yours", yours.value.pullRequests, yours.value.more],
      ["To review", reviewing.value.pullRequests, reviewing.value.more],
    ];
    const shown = groups.filter(([, pulls]) => pulls.length > 0);
    // One table, so the columns line up across both groups.
    const lines = table([
      ["  PULL REQUEST", "REVIEWS", "UPDATED", "TITLE"],
      ...shown.flatMap(([, pulls]) => rows(pulls)),
    ]).split("\n");
    let at = 1;
    const out = [lines[0] ?? ""];
    for (const [title, pulls] of shown) {
      out.push(title, ...lines.slice(at, at + pulls.length));
      at += pulls.length;
    }
    io.stdout(`${out.join("\n")}\n`);
    for (const [title, , more] of groups) {
      if (more)
        io.stderr(`${title}: more than ${maxResults} are open; only ${maxResults} are shown.\n`);
    }
    return ok(0);
  };
}
