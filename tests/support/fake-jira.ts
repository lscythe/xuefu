import { notFound } from "../../src/domain/shared/errors";
import { err, ok } from "../../src/domain/shared/result";
import type { JiraClient } from "../../src/plugins/jira/application/jira-client";
import type { JiraIssue } from "../../src/plugins/jira/domain/issue";

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

/** A Jira that answers every search with `issues`, of `total`, and finds each by its key. */
export function fakeJira(
  issues: readonly JiraIssue[],
  total = issues.length,
  overrides: Partial<JiraClient> = {},
): JiraClient & { readonly searched: { readonly jql: string; readonly max: number }[] } {
  const searched: { jql: string; max: number }[] = [];
  return {
    searched,
    search: (jql, max) => {
      searched.push({ jql, max });
      return Promise.resolve(ok({ issues: [...issues], total }));
    },
    issue: (key) => {
      const found = issues.find((one) => one.key === key);
      return Promise.resolve(found === undefined ? err(notFound("issue", key)) : ok(found));
    },
    browseUrl: (key) => `https://jira.example.com/browse/${key}`,
    ...overrides,
  };
}
