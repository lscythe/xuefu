import { describe, expect, test } from "bun:test";
import {
  categoryTone,
  issueColumns,
  issueCount,
} from "../../../../src/plugins/jira/tui/issue-rows";
import { jiraIssue } from "../../../support/fake-jira";

describe("issue rows", () => {
  test("statuses take Jira's colours for their category", () => {
    expect([categoryTone("todo"), categoryTone("doing"), categoryTone("done")]).toEqual([
      "textMuted",
      "info",
      "success",
    ]);
  });

  test("the count says when the list is cut short", () => {
    const issues = [jiraIssue("MOB-1"), jiraIssue("MOB-2")];
    expect(issueCount({ issues, total: 2 })).toBe("2 issues");
    expect(issueCount({ issues: issues.slice(1), total: 1 })).toBe("1 issue");
    expect(issueCount({ issues, total: 40 })).toBe("2 of 40");
  });

  test("columns fit the widest key and status, cutting long statuses", () => {
    expect(
      issueColumns([
        jiraIssue("MOB-2841"),
        jiraIssue("SDK-4", { status: { name: "Selected for Development", category: "todo" } }),
      ]),
    ).toEqual({ key: 8, status: 16 });
    expect(issueColumns([])).toEqual({ key: 0, status: 0 });
  });
});
