import { inputSchema, type McpTool, toolValues } from "./mcp-tools";

/** Newest first; a client asking for one of these gets it, any other the newest. */
const PROTOCOL_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];

const PARSE_ERROR = -32700;
const INVALID_REQUEST = -32600;
const METHOD_NOT_FOUND = -32601;
const INVALID_PARAMS = -32602;

const INSTRUCTIONS =
  "XueFu is the user's terminal developer cockpit: their workspaces, the work and timer on each, " +
  "their Jira issues and their Bitbucket pull requests. Tools act on the workspace the agent " +
  "runs in unless given another. A tool that changes something, such as approving, merging or " +
  "commenting on a pull request, first answers with what it would do and fails; show that to " +
  "the user, and call the tool again with yes set to true only once they agree.";

/** A command's exit code and what it wrote. */
export interface CommandRun {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

export interface McpServer {
  readonly version: string;
  readonly tools: readonly McpTool[];
  /** Runs a XueFu command line, as the tools build it. */
  run(argv: readonly string[]): Promise<CommandRun>;
  /** Writes text to the client: whole messages, each a line. */
  write(text: string): void;
}

type Id = string | number | null;

interface Request {
  readonly id?: string | number;
  readonly method: string;
  readonly params?: unknown;
}

type Answer =
  | { readonly result: unknown }
  | { readonly error: { readonly code: number; readonly message: string } };

const failure = (code: number, message: string): Answer => ({ error: { code, message } });

function isRequest(message: unknown): message is Request {
  if (typeof message !== "object" || message === null || Array.isArray(message)) return false;
  const { jsonrpc, method, id } = message as Record<string, unknown>;
  return (
    jsonrpc === "2.0" &&
    typeof method === "string" &&
    (id === undefined || typeof id === "string" || typeof id === "number")
  );
}

/** The id of a message that is not a request, to answer it with an error if it has one. */
function idOf(message: unknown): Id {
  if (typeof message !== "object" || message === null) return null;
  const id = (message as Record<string, unknown>)["id"];
  return typeof id === "string" || typeof id === "number" ? id : null;
}

/** Whether a message is the client's answer to a request; XueFu sends none, so they are dropped. */
function isResponse(message: unknown): boolean {
  if (typeof message !== "object" || message === null) return false;
  const fields = message as Record<string, unknown>;
  return !("method" in fields) && ("result" in fields || "error" in fields);
}

function describe(tool: McpTool) {
  return {
    name: tool.name,
    description: tool.description,
    inputSchema: inputSchema(tool),
    annotations: { readOnlyHint: !tool.changes },
  };
}

/** What a tool's command said; a command that found nothing (exit 1) has still done its job. */
function toolResult(run: CommandRun) {
  const said = [run.stdout, run.stderr].filter((text) => text.trim() !== "").join("\n");
  const failed = run.code !== 0 && run.code !== 1;
  return {
    content: [
      {
        type: "text",
        text: said === "" ? (failed ? `Failed with exit code ${run.code}` : "Done.") : said,
      },
    ],
    isError: failed,
  };
}

async function callTool(server: McpServer, params: unknown): Promise<Answer> {
  const { name, arguments: given } = (params ?? {}) as Record<string, unknown>;
  const tool = server.tools.find((candidate) => candidate.name === name);
  if (tool === undefined) return failure(INVALID_PARAMS, `Unknown tool: ${String(name)}`);
  const checked = toolValues(tool, given);
  if (!checked.ok) {
    // Told as the tool's answer, so the agent can correct itself.
    return { result: { content: [{ type: "text", text: checked.message }], isError: true } };
  }
  try {
    return { result: toolResult(await server.run(tool.argv(checked.values))) };
  } catch (thrown) {
    const message = thrown instanceof Error ? thrown.message : String(thrown);
    return { result: { content: [{ type: "text", text: message }], isError: true } };
  }
}

function answer(server: McpServer, request: Request): Promise<Answer> | Answer {
  switch (request.method) {
    case "initialize": {
      const asked = (request.params as Record<string, unknown> | undefined)?.["protocolVersion"];
      return {
        result: {
          protocolVersion:
            typeof asked === "string" && PROTOCOL_VERSIONS.includes(asked)
              ? asked
              : PROTOCOL_VERSIONS[0],
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: "xuefu", title: "XueFu", version: server.version },
          instructions: INSTRUCTIONS,
        },
      };
    }
    case "ping":
      return { result: {} };
    case "tools/list":
      return { result: { tools: server.tools.map(describe) } };
    case "tools/call":
      return callTool(server, request.params);
    default:
      return failure(METHOD_NOT_FOUND, `Method not found: ${request.method}`);
  }
}

/** The reply to one line from the client, or null when it needs none. */
async function reply(server: McpServer, line: string): Promise<object | null> {
  let message: unknown;
  try {
    message = JSON.parse(line);
  } catch {
    return { jsonrpc: "2.0", id: null, ...failure(PARSE_ERROR, "Parse error") };
  }
  if (isResponse(message)) return null;
  if (!isRequest(message)) {
    return { jsonrpc: "2.0", id: idOf(message), ...failure(INVALID_REQUEST, "Invalid request") };
  }
  // A notification: nothing to answer, and nothing XueFu needs to act on.
  if (message.id === undefined) return null;
  return { jsonrpc: "2.0", id: message.id, ...(await answer(server, message)) };
}

/**
 * Serves XueFu's tools over MCP's stdio transport: JSON-RPC messages, one a line, read from
 * `input` until it ends. Requests are answered as they finish, so a slow one holds up no other.
 */
export async function serveMcp(
  server: McpServer,
  input: AsyncIterable<string> | Iterable<string>,
): Promise<void> {
  const pending = new Set<Promise<void>>();
  const take = (line: string) => {
    if (line.trim() === "") return;
    const replied = reply(server, line).then((message) => {
      if (message !== null) server.write(`${JSON.stringify(message)}\n`);
      pending.delete(replied);
    });
    pending.add(replied);
  };
  let buffer = "";
  for await (const chunk of input) {
    const lines = (buffer + chunk).split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) take(line);
  }
  take(buffer);
  await Promise.all(pending);
}
