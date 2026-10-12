import type { AgentHandlers, AgentHost, AgentRunner } from "../application/ports/agent";
import { type McpTools, mcpReply } from "../cli/mcp-server";
import type { McpTool } from "../cli/mcp-tools";
import type { ConfirmationPrompt } from "../domain/shared/confirmation";
import { ok } from "../domain/shared/result";

/** The tool Claude Code asks before using any other, as `--permission-prompt-tool`. */
const APPROVAL = "approval";
/** How a tool of XueFu's is named to the agent. */
const OURS = "mcp__xuefu__";
/** Longest a value is shown when asking, so the dialog stays a dialog. */
const MAX_VALUE = 160;

const INSTRUCTIONS =
  "You are running inside XueFu, the user's terminal developer cockpit, which shows what you " +
  "say in a small terminal dialog: keep answers short, in plain text, without tables. XueFu's " +
  "tools read and act on the user's workspaces, work, Jira issues and Bitbucket pull requests, " +
  "and you may read the files in this folder. The user approves every change in XueFu before " +
  "it runs, so pass yes set to true to tools that change something.";

const APPROVAL_TOOL = {
  name: APPROVAL,
  description:
    "Asks the user in XueFu whether a tool may run. Claude Code calls it; do not call it yourself.",
  inputSchema: {
    type: "object",
    properties: {
      tool_name: { type: "string", description: "the tool that wants to run" },
      input: { type: "object", description: "what it would be passed" },
    },
    required: ["tool_name", "input"],
  },
};

const record = (value: unknown): Readonly<Record<string, unknown>> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

/** One line of at most `MAX_VALUE` columns, for a value the user is asked about. */
function shown(value: unknown, flag: string | null): string {
  if (value === true && flag !== null) return flag;
  const text = (typeof value === "string" ? value : JSON.stringify(value)).replace(/\s+/gu, " ");
  return text.length > MAX_VALUE ? `${text.slice(0, MAX_VALUE - 1)}…` : text;
}

/** What the user is asked before the agent uses a tool: which, and with what. */
export function approvalPrompt(
  agent: string,
  tools: readonly McpTool[],
  name: string,
  input: Readonly<Record<string, unknown>>,
): ConfirmationPrompt {
  const tool = tools.find((candidate) => `${OURS}${candidate.name}` === name);
  // As typed: pr_needs_work is `pr needs-work`.
  const command = tool?.name.replace("_", " ").replaceAll("_", "-") ?? "";
  const details = Object.entries(input).map(([label, value]) => {
    const parameter = tool?.parameters[label];
    return {
      label,
      value: shown(value, parameter?.type === "boolean" ? parameter.description : null),
    };
  });
  // The title names the command, short enough for the frame; what it does is said below.
  return {
    title: tool === undefined ? `Let ${agent} use ${name}` : `Let ${agent} run ${command}`,
    severity: "confirm",
    details: details.length === 0 ? [{ label: "With", value: "nothing" }] : details,
    consequence:
      tool === undefined
        ? `${agent} uses its ${name} tool with what is shown.`
        : `${tool.description}, as you, as xuefu ${command} would, without asking again.`,
    confirmLabel: "Allow",
  };
}

/** A call, as text that is the same for the same tool and arguments in any order. */
const callKey = (name: string, input: Readonly<Record<string, unknown>>) =>
  JSON.stringify([
    name,
    Object.keys(input)
      .sort()
      .map((key) => [key, input[key]]),
  ]);

/**
 * Serves XueFu's tools to agents the cockpit starts. Each session gets its own MCP endpoint on
 * 127.0.0.1, behind a token only that agent is given, and gone when it ends. The agent's reads run
 * freely; anything else is put to the user first, and a change runs only once they allow it.
 */
export function agentHost(runner: AgentRunner, tools: McpTools): AgentHost {
  const answer = async (
    text: string,
    approvals: Set<string>,
    handlers: AgentHandlers,
  ): Promise<object | null> => {
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(text);
    } catch {
      // Answered as a parse error below.
    }
    const message = record(parsed);
    const params = record(message?.["params"]);
    const id = message?.["id"] ?? null;
    if (message?.["method"] === "tools/call" && params?.["name"] === APPROVAL) {
      const asked = record(params["arguments"]);
      const name = typeof asked?.["tool_name"] === "string" ? asked["tool_name"] : "";
      const input = record(asked?.["input"]) ?? {};
      const allowed = await handlers.approve(approvalPrompt(runner.name, tools.tools, name, input));
      if (allowed) approvals.add(callKey(name.replace(OURS, ""), input));
      const decision = allowed
        ? { behavior: "allow", updatedInput: input }
        : { behavior: "deny", message: "The user did not allow it." };
      return {
        jsonrpc: "2.0",
        id,
        result: { content: [{ type: "text", text: JSON.stringify(decision) }] },
      };
    }
    if (message?.["method"] === "tools/call") {
      const name = String(params?.["name"]);
      const input = record(params?.["arguments"]) ?? {};
      const tool = tools.tools.find((candidate) => candidate.name === name);
      if (tool?.changes === true && !approvals.delete(callKey(name, input))) {
        return {
          jsonrpc: "2.0",
          id,
          result: {
            content: [{ type: "text", text: "XueFu runs a change only once the user allows it." }],
            isError: true,
          },
        };
      }
    }
    const reply = await mcpReply({ ...tools, instructions: INSTRUCTIONS }, text);
    const listed = record(record(reply)?.["result"])?.["tools"];
    if (message?.["method"] === "tools/list" && Array.isArray(listed)) listed.push(APPROVAL_TOOL);
    return reply;
  };

  return {
    name: runner.name,
    ask(question, handlers) {
      const token = crypto.randomUUID();
      const approvals = new Set<string>();
      const server = Bun.serve({
        hostname: "127.0.0.1",
        port: 0,
        // A request can wait on the user, for as long as they take to answer.
        idleTimeout: 0,
        fetch: async (request) => {
          if (new URL(request.url).pathname !== "/mcp") return new Response(null, { status: 404 });
          if (request.headers.get("authorization") !== `Bearer ${token}`) {
            return new Response(null, { status: 401 });
          }
          if (request.method !== "POST") {
            return new Response(null, { status: 405, headers: { Allow: "POST" } });
          }
          const reply = await answer(await request.text(), approvals, handlers);
          return reply === null ? new Response(null, { status: 202 }) : Response.json(reply);
        },
      });
      const started = runner.start(
        {
          cwd: question.cwd,
          prompt: question.prompt,
          instructions: INSTRUCTIONS,
          mcp: { url: `http://127.0.0.1:${server.port}/mcp`, token },
          readTools: tools.tools.filter((tool) => !tool.changes).map((tool) => tool.name),
          approvalTool: APPROVAL,
        },
        (event) => {
          if (event.kind === "exit") void server.stop(true);
          handlers.onEvent(event);
        },
      );
      if (!started.ok) void server.stop(true);
      return started.ok ? ok(started.value) : started;
    },
  };
}
