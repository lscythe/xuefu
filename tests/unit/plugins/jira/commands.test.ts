import { describe, expect, test } from "bun:test";
import type { AppError } from "../../../../src/application/errors";
import type { PluginInvocation } from "../../../../src/cli/plugin-command";
import { notFound } from "../../../../src/domain/shared/errors";
import { err, ok, type Result } from "../../../../src/domain/shared/result";
import type { JiraClient } from "../../../../src/plugins/jira/application/jira-client";
import { jiraCommands } from "../../../../src/plugins/jira/cli/commands";
import type { JiraIssue } from "../../../../src/plugins/jira/domain/issue";

const issue = (key: string, extra: Partial<JiraIssue> = {}): JiraIssue => ({
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

function fakeJira(issues: JiraIssue[], total = issues.length) {
  const searched: { jql: string; max: number }[] = [];
  const client: JiraClient = {
    search: (jql, max) => {
      searched.push({ jql, max });
      return Promise.resolve(ok({ issues, total }));
    },
    issue: (key) => {
      const found = issues.find((one) => one.key === key);
      return Promise.resolve(found === undefined ? err(notFound("issue", key)) : ok(found));
    },
    browseUrl: (key) => `https://jira.example.com/browse/${key}`,
  };
  return { client, searched };
}

async function run(
  client: JiraClient,
  name: string,
  args: string[] = [],
  flags: PluginInvocation["flags"] = {},
) {
  let stdout = "";
  let stderr = "";
  const code: Result<number, AppError> = await jiraCommands(client, {
    jql: "assignee = currentUser()",
    maxResults: 50,
  })(
    { group: "jira", name, args, flags },
    {
      workspace: () => Promise.reject(new Error("jira needs no workspace")),
      stdout: (text) => {
        stdout += text;
      },
      stderr: (text) => {
        stderr += text;
      },
    },
  );
  return { code, stdout, stderr };
}

describe("xuefu jira issues", () => {
  test("lists the configured query's issues, saying when more match", async () => {
    const { client, searched } = fakeJira(
      [issue("MOB-2841"), issue("MOB-2790", { status: { name: "To Do", category: "todo" } })],
      7,
    );
    const shown = await run(client, "issues");
    expect(searched).toEqual([{ jql: "assignee = currentUser()", max: 50 }]);
    expect(shown.code).toEqual(ok(0));
    expect(shown.stdout.split("\n")[0]).toMatch(/^KEY\s+STATUS\s+UPDATED\s+SUMMARY$/);
    expect(shown.stdout).toContain("MOB-2841  In Progress  ");
    expect(shown.stdout).toContain("Work on MOB-2790");
    expect(shown.stderr).toBe("2 of 7 shown; narrow the query with --jql.\n");
  });

  test("--jql asks another query; none matching exits 1", async () => {
    const { client, searched } = fakeJira([]);
    const shown = await run(client, "issues", [], { jql: "project = MOB" });
    expect(searched[0]?.jql).toBe("project = MOB");
    expect(shown.code).toEqual(ok(1));
    expect(shown.stderr).toBe("No issues match: project = MOB\n");
  });

  test("--json gives the issues with their addresses", async () => {
    const { client } = fakeJira([issue("MOB-2841")]);
    const shown = await run(client, "issues", [], { json: true });
    expect(JSON.parse(shown.stdout)).toMatchObject({
      jql: "assignee = currentUser()",
      total: 1,
      issues: [
        {
          key: "MOB-2841",
          status: "In Progress",
          statusCategory: "doing",
          updated: "2026-10-06T13:59:00.000Z",
          url: "https://jira.example.com/browse/MOB-2841",
        },
      ],
    });
  });
});

describe("xuefu jira show", () => {
  test("shows the issue's details, address and description", async () => {
    const { client } = fakeJira([issue("MOB-2841", { description: "h3. Criteria\n* Face ID" })]);
    const shown = await run(client, "show", ["MOB-2841"]);
    expect(shown.code).toEqual(ok(0));
    const lines = shown.stdout.split("\n");
    expect(lines[0]).toBe("MOB-2841  Work on MOB-2841");
    expect(shown.stdout).toContain("  Status    In Progress\n");
    expect(shown.stdout).toContain("  Assignee  Dana Scully\n");
    expect(shown.stdout).toContain(
      "  https://jira.example.com/browse/MOB-2841\n\nh3. Criteria\n* Face ID\n",
    );
  });

  test("unassigned is said, and missing fields left out", async () => {
    const { client } = fakeJira([
      issue("MOB-1", { assignee: null, priority: null, reporter: null }),
    ]);
    const shown = await run(client, "show", ["MOB-1"]);
    expect(shown.stdout).toContain("  Assignee  Unassigned\n");
    expect(shown.stdout).not.toContain("Priority");
    expect(shown.stdout).not.toContain("Reporter");
  });

  test("--json, and the failures: not a key, or not found", async () => {
    const { client } = fakeJira([issue("MOB-2841")]);
    expect(
      JSON.parse((await run(client, "show", ["MOB-2841"], { json: true })).stdout),
    ).toMatchObject({ key: "MOB-2841", url: "https://jira.example.com/browse/MOB-2841" });
    const bad = await run(client, "show", ["not a key"]);
    expect(bad.code.ok ? null : bad.code.error.kind).toBe("validation");
    const missing = await run(client, "show", ["MOB-9"]);
    expect(missing.code.ok ? null : missing.code.error.kind).toBe("not-found");
  });
});
