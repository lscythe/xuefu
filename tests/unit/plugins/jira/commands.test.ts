import { describe, expect, test } from "bun:test";
import type { AppError } from "../../../../src/application/errors";
import type { PluginInvocation } from "../../../../src/cli/plugin-command";
import { remoteError } from "../../../../src/domain/shared/errors";
import type { WorkspaceId } from "../../../../src/domain/shared/ids";
import type { AbsolutePath } from "../../../../src/domain/shared/path";
import { err, ok, type Result } from "../../../../src/domain/shared/result";
import type { Timestamp } from "../../../../src/domain/shared/time";
import type { Workspace, WorkspaceName } from "../../../../src/domain/workspace/workspace";
import type { JiraClient } from "../../../../src/plugins/jira/application/jira-client";
import { jiraCommands } from "../../../../src/plugins/jira/cli/commands";
import { fakeJira, jiraIssue as issue, jiraChangesFor, WORKFLOW } from "../../../support/fake-jira";

const MOBILE: Workspace = {
  id: "mobile" as WorkspaceId,
  name: "Mobile" as WorkspaceName,
  path: "/work/mobile" as AbsolutePath,
  group: null,
  addedAt: 0 as Timestamp,
  lastActiveAt: null,
};

async function run(
  client: JiraClient,
  name: string,
  args: string[] = [],
  flags: PluginInvocation["flags"] = {},
) {
  let stdout = "";
  let stderr = "";
  const asked: (string | null)[] = [];
  const { changes, started } = jiraChangesFor(client);
  const code: Result<number, AppError> = await jiraCommands(
    { jql: "assignee = currentUser()", maxResults: 50 },
    changes,
  )(
    { group: "jira", name, args, flags },
    {
      workspace: (id) => {
        asked.push(id);
        return Promise.resolve(ok(MOBILE));
      },
      stdout: (text) => {
        stdout += text;
      },
      stderr: (text) => {
        stderr += text;
      },
    },
  );
  return { code, stdout, stderr, started, asked };
}

describe("xuefu jira issues", () => {
  test("lists the configured query's issues, saying when more match", async () => {
    const client = fakeJira(
      [issue("MOB-2841"), issue("MOB-2790", { status: { name: "To Do", category: "todo" } })],
      7,
    );
    const shown = await run(client, "issues");
    expect(client.searched).toEqual([{ jql: "assignee = currentUser()", max: 50 }]);
    expect(shown.code).toEqual(ok(0));
    expect(shown.stdout.split("\n")[0]).toMatch(/^KEY\s+STATUS\s+UPDATED\s+SUMMARY$/);
    expect(shown.stdout).toContain("MOB-2841  In Progress  ");
    expect(shown.stdout).toContain("Work on MOB-2790");
    expect(shown.stderr).toBe("2 of 7 shown; narrow the query with --jql.\n");
  });

  test("--jql asks another query; none matching exits 1", async () => {
    const client = fakeJira([]);
    const shown = await run(client, "issues", [], { jql: "project = MOB" });
    expect(client.searched[0]?.jql).toBe("project = MOB");
    expect(shown.code).toEqual(ok(1));
    expect(shown.stderr).toBe("No issues match: project = MOB\n");
  });

  test("--json gives the issues with their addresses", async () => {
    const client = fakeJira([issue("MOB-2841")]);
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
    const client = fakeJira([issue("MOB-2841", { description: "h3. Criteria\n* Face ID" })]);
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
    const client = fakeJira([issue("MOB-1", { assignee: null, priority: null, reporter: null })]);
    const shown = await run(client, "show", ["MOB-1"]);
    expect(shown.stdout).toContain("  Assignee  Unassigned\n");
    expect(shown.stdout).not.toContain("Priority");
    expect(shown.stdout).not.toContain("Reporter");
  });

  test("--json, and the failures: not a key, or not found", async () => {
    const client = fakeJira([issue("MOB-2841")]);
    expect(
      JSON.parse((await run(client, "show", ["MOB-2841"], { json: true })).stdout),
    ).toMatchObject({ key: "MOB-2841", url: "https://jira.example.com/browse/MOB-2841" });
    const bad = await run(client, "show", ["not a key"]);
    expect(bad.code.ok ? null : bad.code.error.kind).toBe("validation");
    const missing = await run(client, "show", ["MOB-9"]);
    expect(missing.code.ok ? null : missing.code.error.kind).toBe("not-found");
  });
});

describe("xuefu jira start", () => {
  const TODO = issue("MOB-2802", {
    summary: "Show pending card transactions",
    status: { name: "To Do", category: "todo" },
  });

  test("works on the issue here, titled with its summary, and says how to move it", async () => {
    const client = fakeJira([TODO]);
    const shown = await run(client, "start", ["mob-2802"]);
    expect(shown.code).toEqual(ok(0));
    expect(shown.asked).toEqual([null]);
    expect(shown.started).toEqual([
      { workspace: "mobile", issue: "MOB-2802", title: "Show pending card transactions" },
    ]);
    expect(shown.stdout).toBe("✓ Working on MOB-2802 (Show pending card transactions) in mobile\n");
    expect(shown.stderr).toBe("MOB-2802 is To Do in Jira; add --yes to move it to In Progress.\n");
    expect(client.moved).toEqual([]);
  });

  test("--yes moves it to in progress in Jira too; -w picks the workspace", async () => {
    const client = fakeJira([TODO]);
    const shown = await run(client, "start", ["MOB-2802"], { yes: true, workspace: "mobile" });
    expect(shown.asked).toEqual(["mobile"]);
    expect(client.moved).toEqual([{ key: "MOB-2802", id: "11" }]);
    expect(shown.stdout).toEndWith("✓ Moved MOB-2802 to In Progress in Jira\n");
    expect(shown.stderr).toBe("");
  });

  test("an issue already under way is only worked on", async () => {
    const client = fakeJira([issue("MOB-2841")]);
    const shown = await run(client, "start", ["MOB-2841"], { yes: true });
    expect(shown.code).toEqual(ok(0));
    expect(client.moved).toEqual([]);
    expect(shown.stderr).toBe("");
  });

  test("says when the workflow has no move to start it, or its moves cannot be read", async () => {
    const done = WORKFLOW.filter((move) => move.to.category === "done");
    const none = await run(
      fakeJira([TODO], 1, { transitions: () => Promise.resolve(ok(done)) }),
      "start",
      ["MOB-2802"],
    );
    expect(none.stderr).toBe("MOB-2802 has no move to in progress in Jira; it stays To Do.\n");
    const unread = await run(
      fakeJira([TODO], 1, {
        transitions: () =>
          Promise.resolve(err(remoteError("Jira answered 500", "jira.example.com", 500))),
      }),
      "start",
      ["MOB-2802"],
      { yes: true },
    );
    expect(unread.code).toEqual(ok(0));
    expect(unread.stderr).toBe("Could not read how MOB-2802 moves in Jira: Jira answered 500\n");
  });

  test("a move Jira refuses fails the command, after the work has started", async () => {
    const shown = await run(
      fakeJira([TODO], 1, {
        transition: () =>
          Promise.resolve(err(remoteError("Jira did not move MOB-2802", "jira.example.com", 400))),
      }),
      "start",
      ["MOB-2802"],
      { yes: true },
    );
    expect(shown.stdout).toContain("✓ Working on MOB-2802");
    expect(shown.code.ok ? null : shown.code.error.message).toBe("Jira did not move MOB-2802");
  });

  test("not a key, or not an issue, starts nothing", async () => {
    const bad = await run(fakeJira([TODO]), "start", ["not a key"]);
    expect(bad.code.ok ? null : bad.code.error.kind).toBe("validation");
    const missing = await run(fakeJira([TODO]), "start", ["MOB-1"]);
    expect(missing.code.ok ? null : missing.code.error.kind).toBe("not-found");
    expect([...bad.started, ...missing.started]).toEqual([]);
  });
});
