import { describe, expect, test } from "bun:test";
import { PLUGIN_COMMANDS } from "../../../src/bootstrap/plugins";
import { inputSchema, type McpTool, mcpTools, toolValues } from "../../../src/cli/mcp-tools";
import { parseArgs } from "../../../src/cli/parse-args";

const TOOLS = mcpTools(PLUGIN_COMMANDS);

function tool(name: string): McpTool {
  const found = TOOLS.find((candidate) => candidate.name === name);
  if (found === undefined) throw new Error(`no tool ${name}`);
  return found;
}

/** The command line a tool runs for these arguments, checked as an agent would send them. */
function argv(name: string, given: Record<string, unknown> = {}): string[] {
  const checked = toolValues(tool(name), given);
  if (!checked.ok) throw new Error(checked.message);
  return tool(name).argv(checked.values);
}

describe("mcpTools", () => {
  test("the core's commands, then every plugin command as <group>_<name>", () => {
    expect(TOOLS.map((each) => each.name)).toEqual([
      "workspace_list",
      "work_status",
      "work_start",
      "work_finish",
      "timer_status",
      "note_show",
      "note_append",
      "activity",
      "git_status",
      "jira_issues",
      "jira_show",
      "jira_start",
      "pr_list",
      "pr_show",
      "pr_diff",
      "pr_comments",
      "pr_approve",
      "pr_needs_work",
      "pr_unapprove",
      "pr_merge",
      "pr_comment",
    ]);
  });

  test("only tools that change something are marked so", () => {
    expect(TOOLS.filter((each) => each.changes).map((each) => each.name)).toEqual([
      "work_start",
      "work_finish",
      "note_append",
      "jira_start",
      "pr_approve",
      "pr_needs_work",
      "pr_unapprove",
      "pr_merge",
      "pr_comment",
    ]);
  });

  test("every tool, given every argument, builds a command line XueFu runs", () => {
    for (const each of TOOLS) {
      const values = Object.fromEntries(
        Object.entries(each.parameters).map(([name, parameter]) => [
          name,
          parameter.type === "boolean" ? true : parameter.type === "integer" ? "5" : "MOB-1",
        ]),
      );
      const parsed = parseArgs(each.argv(values), PLUGIN_COMMANDS);
      expect(parsed.ok && parsed.value.kind).toBe("run");
    }
  });

  test("the core's commands ask for machine-readable output, and take flags and arguments", () => {
    expect(argv("work_status")).toEqual(["work", "status", "--json"]);
    expect(argv("work_start", { issue: "MOB-1", title: "Login", workspace: "mob" })).toEqual([
      "work",
      "start",
      "--title=Login",
      "--workspace=mob",
      "--",
      "MOB-1",
    ]);
    expect(argv("note_append", { text: "-- ask QA" })).toEqual([
      "note",
      "append",
      "--",
      "-- ask QA",
    ]);
    expect(argv("activity", { limit: 5 })).toEqual(["activity", "--json", "--limit=5"]);
  });

  test("a plugin's command takes its flags and its argument by name", () => {
    expect(argv("pr_show", { pullRequest: "MOB/app#42" })).toEqual([
      "pr",
      "show",
      "--json",
      "--",
      "MOB/app#42",
    ]);
    expect(argv("pr_comment", { message: "-1 from me", line: 12, old: true, yes: false })).toEqual([
      "pr",
      "comment",
      "--message=-1 from me",
      "--line=12",
      "--old",
    ]);
    expect(argv("pr_list")).toEqual(["pr", "list", "--json"]);
    expect(argv("jira_start", { key: "MOB-1", yes: true })).toEqual([
      "jira",
      "start",
      "--yes",
      "--",
      "MOB-1",
    ]);
  });
});

describe("inputSchema", () => {
  test("names each argument with its type and says which are needed", () => {
    expect(inputSchema(tool("jira_show"))).toEqual({
      type: "object",
      properties: {
        key: { type: "string", description: "the issue's key, such as MOB-123" },
      },
      required: ["key"],
      additionalProperties: false,
    });
    expect(inputSchema(tool("pr_merge")).required).toEqual([]);
    expect(Object.keys(inputSchema(tool("pr_comments")).properties)).toEqual([
      "pullRequest",
      "workspace",
    ]);
  });
});

describe("toolValues", () => {
  const check = (name: string, given: unknown) => {
    const checked = toolValues(tool(name), given);
    return checked.ok ? checked.values : checked.message;
  };

  test("nothing given is no arguments; nulls are left out", () => {
    expect(check("pr_list", undefined)).toEqual({});
    expect(check("pr_show", { pullRequest: null })).toEqual({});
  });

  test("what is wrong is said, so the agent can correct it", () => {
    expect(check("pr_list", [])).toBe("Arguments must be an object");
    expect(check("pr_list", "MOB/app#42")).toBe("Arguments must be an object");
    expect(check("pr_list", { mine: true })).toBe("Unknown argument: mine");
    expect(check("pr_approve", { yes: "yes" })).toBe("yes must be true or false");
    expect(check("activity", { limit: 2.5 })).toBe("limit must be a whole number");
    expect(check("pr_comment", { message: ["hi"] })).toBe("message must be text");
    expect(check("work_start", {})).toBe("Missing argument: issue");
    expect(check("pr_list", { toString: 1 })).toBe("Unknown argument: toString");
  });
});
