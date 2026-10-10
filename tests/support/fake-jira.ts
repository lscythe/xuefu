import { CommandBus } from "../../src/application/commands/command-bus";
import { registerPluginActions } from "../../src/bootstrap/plugins";
import { notFound } from "../../src/domain/shared/errors";
import { err, ok } from "../../src/domain/shared/result";
import { jiraActions } from "../../src/plugins/jira/application/actions";
import type { JiraClient } from "../../src/plugins/jira/application/jira-client";
import type { JiraChanges } from "../../src/plugins/jira/application/start-work";
import type { JiraIssue, JiraTransition } from "../../src/plugins/jira/domain/issue";
import { jiraPlugin } from "../../src/plugins/jira/plugin";
import { fakeCore, pluginContext, type StartWorkCall } from "./plugin-context";
import { SequentialIds } from "./sequential-ids";

/** An issue in progress, with what is not given filled in. */
export const jiraIssue = (key: string, extra: Partial<JiraIssue> = {}): JiraIssue => ({
  key,
  summary: `Work on ${key}`,
  status: { name: "In Progress", category: "doing" },
  type: "Story",
  priority: "High",
  assignee: "Dana Scully",
  reporter: "Fox Mulder",
  created: Date.UTC(2026, 9, 1, 9, 12),
  updated: Date.UTC(2026, 9, 6, 13, 59),
  description: null,
  ...extra,
});

/** The moves a simple workflow offers: to In Progress and to Done. */
export const WORKFLOW: readonly JiraTransition[] = [
  { id: "11", name: "Start Progress", to: { name: "In Progress", category: "doing" } },
  { id: "31", name: "Done", to: { name: "Done", category: "done" } },
];

/**
 * A Jira that answers every search with `issues`, of `total`, finds each by its key, offers
 * WORKFLOW's moves, and remembers the moves made.
 */
export function fakeJira(
  issues: readonly JiraIssue[],
  total = issues.length,
  overrides: Partial<JiraClient> = {},
): JiraClient & {
  readonly searched: { readonly jql: string; readonly max: number }[];
  readonly moved: { readonly key: string; readonly id: string }[];
} {
  const searched: { jql: string; max: number }[] = [];
  const moved: { key: string; id: string }[] = [];
  return {
    searched,
    moved,
    search: (jql, max) => {
      searched.push({ jql, max });
      return Promise.resolve(ok({ issues: [...issues], total }));
    },
    issue: (key) => {
      const found = issues.find((one) => one.key === key);
      return Promise.resolve(found === undefined ? err(notFound("issue", key)) : ok(found));
    },
    transitions: () => Promise.resolve(ok([...WORKFLOW])),
    transition: (key, id) => {
      moved.push({ key, id });
      return Promise.resolve(ok(undefined));
    },
    browseUrl: (key) => `https://jira.example.com/browse/${key}`,
    ...overrides,
  };
}

/**
 * What the Jira plugin's changes are given, over `client`: a real bus carrying the move and a
 * stand-in work.start that answers `answer`, remembering what it was asked.
 */
export function jiraChangesFor(
  client: JiraClient,
  answer?: Parameters<typeof fakeCore>[0],
): { readonly changes: JiraChanges; readonly started: StartWorkCall[] } {
  const context = pluginContext();
  const { core, started } = fakeCore(answer);
  const bus = new CommandBus({
    logger: context.logger,
    clock: context.clock,
    ids: new SequentialIds(),
  });
  bus.register(core.startWork);
  const actions = jiraActions(client);
  registerPluginActions(bus, [{ plugin: jiraPlugin, parts: { actions: [actions.move] } }]);
  return {
    changes: {
      client,
      startWork: core.startWork,
      invoke: (command, input, options) => bus.invoke(command, input, options),
      actions,
    },
    started,
  };
}
