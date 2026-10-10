import { confirmationTokenFor } from "../../../application/commands/command";
import { formatStartedWork, table } from "../../../cli/format";
import type { PluginCommandRunner, PluginCommandSpec } from "../../../cli/plugin-command";
import { ok } from "../../../domain/shared/result";
import type { Timestamp } from "../../../domain/shared/time";
import { wallClock } from "../../../domain/shared/wall-clock";
import { issueKey } from "../../../domain/work/issue-key";
import type { JiraClient } from "../application/jira-client";
import { type JiraChanges, startWorkOnIssue } from "../application/start-work";
import type { JiraIssue } from "../domain/issue";

const json = { type: "boolean", description: "machine-readable output" } as const;

export const JIRA_COMMANDS: readonly PluginCommandSpec[] = [
  {
    group: "jira",
    name: "issues",
    isDefault: true,
    usage: "",
    minArgs: 0,
    maxArgs: 0,
    flags: {
      jql: { type: "string", value: "<query>", description: "another JQL query than config's" },
      json,
    },
    summary: "List your open Jira issues, or those a JQL query finds",
  },
  {
    group: "jira",
    name: "show",
    usage: "<key>",
    minArgs: 1,
    maxArgs: 1,
    flags: { json },
    summary: "Show a Jira issue",
  },
  {
    group: "jira",
    name: "start",
    usage: "<key>",
    minArgs: 1,
    maxArgs: 1,
    flags: {
      workspace: {
        type: "string",
        short: "w",
        value: "<id>",
        description: "another workspace than this folder's",
      },
      yes: { type: "boolean", description: "also move the issue to in progress in Jira" },
    },
    summary: "Work on a Jira issue here and time it; --yes also moves it to in progress",
  },
];

/** What the commands take from the plugin's settings. */
export interface JiraQuery {
  readonly jql: string;
  readonly maxResults: number;
}

const when = (at: number) => {
  const clock = wallClock(at as Timestamp);
  return `${clock.date} ${clock.time}`;
};

const issueJson = (client: JiraClient, issue: JiraIssue) => ({
  ...issue,
  status: issue.status.name,
  statusCategory: issue.status.category,
  created: new Date(issue.created).toISOString(),
  updated: new Date(issue.updated).toISOString(),
  url: client.browseUrl(issue.key),
});

function formatIssue(client: JiraClient, issue: JiraIssue): string {
  const details = [
    ["Status", issue.status.name],
    ["Type", issue.type],
    ["Priority", issue.priority],
    ["Assignee", issue.assignee ?? "Unassigned"],
    ["Reporter", issue.reporter],
    ["Created", when(issue.created)],
    ["Updated", when(issue.updated)],
  ].filter((row): row is [string, string] => row[1] !== null);
  const description = issue.description?.trim() ?? "";
  return [
    `${issue.key}  ${issue.summary}`,
    table(details.map(([label, value]) => [`  ${label}`, value])).trimEnd(),
    `  ${client.browseUrl(issue.key)}`,
    ...(description === "" ? [] : ["", description]),
    "",
  ].join("\n");
}

/**
 * `xuefu jira start`: works on the issue in the workspace and times it. Moving it in Jira as well
 * takes --yes; without it, the command says how.
 */
const start: (changes: JiraChanges) => PluginCommandRunner =
  (changes) => async (invocation, io) => {
    const key = issueKey(invocation.args[0] ?? "");
    if (!key.ok) return key;
    const id = invocation.flags["workspace"];
    const workspace = await io.workspace(typeof id === "string" ? id : null);
    if (!workspace.ok) return workspace;
    const started = await startWorkOnIssue(changes, workspace.value.id, key.value);
    if (!started.ok) return started;
    const { issue, move, unread } = started.value;
    io.stdout(`${formatStartedWork(started.value.started).join("\n")}\n`);
    if (unread !== null) {
      io.stderr(`Could not read how ${issue.key} moves in Jira: ${unread.message}\n`);
    } else if (move === null && issue.status.category === "todo") {
      io.stderr(
        `${issue.key} has no move to in progress in Jira; it stays ${issue.status.name}.\n`,
      );
    } else if (move !== null && invocation.flags["yes"] !== true) {
      io.stderr(`${issue.key} is ${move.from} in Jira; add --yes to move it to ${move.to}.\n`);
    } else if (move !== null) {
      const asked = await changes.invoke(changes.actions.move, move);
      const moved =
        !asked.ok && asked.error.kind === "confirmation-required"
          ? await changes.invoke(changes.actions.move, move, {
              confirmation: confirmationTokenFor(asked.error),
            })
          : asked;
      if (!moved.ok) return moved;
      io.stdout(`✓ Moved ${issue.key} to ${move.to} in Jira\n`);
    }
    return ok(0);
  };

/**
 * Runs `xuefu jira issues`, `show` and `start`; issues exits 1 when none match.
 */
export function jiraCommands(query: JiraQuery, changes: JiraChanges): PluginCommandRunner {
  const { client } = changes;
  const starting = start(changes);
  return async (invocation, io) => {
    if (invocation.name === "start") return starting(invocation, io);
    const asJson = invocation.flags["json"] === true;
    if (invocation.name === "show") {
      const key = issueKey(invocation.args[0] ?? "");
      if (!key.ok) return key;
      const found = await client.issue(key.value);
      if (!found.ok) return found;
      io.stdout(
        asJson
          ? `${JSON.stringify(issueJson(client, found.value), null, 2)}\n`
          : formatIssue(client, found.value),
      );
      return ok(0);
    }

    const given = invocation.flags["jql"];
    const jql = typeof given === "string" ? given : query.jql;
    const found = await client.search(jql, query.maxResults);
    if (!found.ok) return found;
    const { issues, total } = found.value;
    if (asJson) {
      io.stdout(
        `${JSON.stringify({ jql, total, issues: issues.map((issue) => issueJson(client, issue)) }, null, 2)}\n`,
      );
    } else if (issues.length === 0) {
      io.stderr(`No issues match: ${jql}\n`);
    } else {
      io.stdout(
        table([
          ["KEY", "STATUS", "UPDATED", "SUMMARY"],
          ...issues.map((issue) => [
            issue.key,
            issue.status.name,
            when(issue.updated),
            issue.summary,
          ]),
        ]),
      );
      if (total > issues.length) {
        io.stderr(`${issues.length} of ${total} shown; narrow the query with --jql.\n`);
      }
    }
    return ok(issues.length === 0 ? 1 : 0);
  };
}
