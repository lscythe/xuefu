import type { AppError } from "../../../application/errors";
import { table } from "../../../cli/format";
import type { PluginCommandRunner, PluginCommandSpec } from "../../../cli/plugin-command";
import { ok, type Result } from "../../../domain/shared/result";
import type { Timestamp } from "../../../domain/shared/time";
import { wallClock } from "../../../domain/shared/wall-clock";
import type { PullRequestClient } from "../application/pull-request-client";
import {
  type BuildSummary,
  type PullRequest,
  parsePullRequestRef,
  pullRequestRef,
  reviewSummary,
} from "../domain/pull-request";

const json = { type: "boolean", description: "machine-readable output" } as const;

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
    usage: "<PROJECT/repository#id>",
    minArgs: 1,
    maxArgs: 1,
    flags: { json },
    summary: "Show a pull request, with its reviews and builds",
  },
];

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

/** Runs `xuefu pr list` and `show`; list exits 1 when there is none. */
export function prCommands(client: PullRequestClient, maxResults: number): PluginCommandRunner {
  return async (invocation, io) => {
    const asJson = invocation.flags["json"] === true;
    if (invocation.name === "show") {
      const ref = parsePullRequestRef(invocation.args[0] ?? "");
      if (!ref.ok) return ref;
      const found = await client.pullRequest(ref.value.repository, ref.value.id);
      if (!found.ok) return found;
      const builds = await client.builds(found.value.commit);
      io.stdout(
        asJson
          ? `${JSON.stringify({ ...pullJson(found.value), builds: builds.ok ? builds.value : null }, null, 2)}\n`
          : formatPullRequest(found.value, builds),
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
