import type {
  AgentEvent,
  AgentLaunch,
  AgentModel,
  AgentRunner,
  AgentSession,
} from "../../application/ports/agent";
import { processError } from "../../domain/shared/errors";
import { err, ok } from "../../domain/shared/result";
import { childEnvironment } from "../process/bun-process-runner";
import { lines } from "./lines";

/** What XueFu's MCP server is called in the session, so its tools are `mcp__xuefu__<name>`. */
const SERVER = "xuefu";
/** Claude Code's own tools it may have: it reads the workspace, and changes nothing. */
const BUILT_IN = ["Read", "Grep", "Glob"];
/** How long a stopped agent gets between SIGTERM and SIGKILL. */
const DEFAULT_GRACE_MS = 2000;

/** What Claude Code needs beyond what every child gets: its credentials, provider and proxy. */
const PASSED_PREFIXES = ["ANTHROPIC_", "CLAUDE_", "AWS_", "GOOGLE_", "VERTEX_", "CLOUD_ML_"];
const PASSED = new Set([
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "NO_PROXY",
  "http_proxy",
  "https_proxy",
  "no_proxy",
  "NODE_EXTRA_CA_CERTS",
  "SSL_CERT_FILE",
  "SSL_CERT_DIR",
]);

/** The environment Claude Code runs in: the usual allow-list, its own settings, nothing more. */
export function agentEnvironment(
  parent: Readonly<Record<string, string | undefined>>,
): Record<string, string> {
  const own: Record<string, string> = {};
  for (const [name, value] of Object.entries(parent)) {
    if (value === undefined) continue;
    if (PASSED.has(name) || PASSED_PREFIXES.some((prefix) => name.startsWith(prefix))) {
      own[name] = value;
    }
  }
  return childEnvironment(parent, own);
}

const mcpName = (tool: string) => `mcp__${SERVER}__${tool}`;

/**
 * Claude Code's arguments: headless, reading and writing JSON a line at a time, with XueFu's tools
 * and the read-only servers it is given, and no others. Its reads run freely; anything else is
 * asked of XueFu's approval tool, which asks the user. The session is not saved, so it stays out
 * of Claude Code's own history.
 */
export function claudeArgs(launch: AgentLaunch): string[] {
  const config = {
    mcpServers: {
      [SERVER]: {
        type: "http",
        url: launch.mcp.url,
        headers: { Authorization: `Bearer ${launch.mcp.token}` },
      },
      ...Object.fromEntries(
        launch.servers.map((server) => [
          server.name,
          { type: "stdio", command: server.command, args: server.args },
        ]),
      ),
    },
  };
  return [
    "-p",
    "--input-format",
    "stream-json",
    "--output-format",
    "stream-json",
    "--verbose",
    "--mcp-config",
    JSON.stringify(config),
    "--strict-mcp-config",
    "--tools",
    BUILT_IN.join(","),
    "--allowedTools",
    // A server's name alone allows every tool it has.
    [
      ...launch.readTools.map(mcpName),
      ...launch.servers.map((server) => `mcp__${server.name}`),
    ].join(","),
    "--permission-prompt-tool",
    mcpName(launch.approvalTool),
    "--no-session-persistence",
    "--append-system-prompt",
    launch.instructions,
    ...(launch.model === null ? [] : ["--model", launch.model]),
  ];
}

/** The models Claude Code runs by alias, each the latest of its kind, after its own default. */
const MODELS: readonly AgentModel[] = [
  { id: null, name: "Claude Code's default" },
  { id: "fable", name: "Fable" },
  { id: "opus", name: "Opus" },
  { id: "sonnet", name: "Sonnet" },
  { id: "haiku", name: "Haiku" },
];

/** A message from the user, as Claude Code reads one on stdin. */
export function userMessage(text: string): string {
  return `${JSON.stringify({ type: "user", message: { role: "user", content: text } })}\n`;
}

const record = (value: unknown): Readonly<Record<string, unknown>> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

/** What one line of Claude Code's output says, as events; lines XueFu does not use say nothing. */
export function claudeEvents(line: string): AgentEvent[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return [];
  }
  const message = record(parsed);
  switch (message?.["type"]) {
    case "system":
      return message["subtype"] === "init"
        ? [{ kind: "ready", model: typeof message["model"] === "string" ? message["model"] : null }]
        : [];
    case "assistant": {
      const content = record(message["message"])?.["content"];
      if (!Array.isArray(content)) return [];
      return content.flatMap((part): AgentEvent[] => {
        const block = record(part);
        if (block?.["type"] === "text" && typeof block["text"] === "string") {
          return block["text"].trim() === "" ? [] : [{ kind: "text", text: block["text"] }];
        }
        if (block?.["type"] === "tool_use" && typeof block["name"] === "string") {
          // XueFu's tools by their own names; another server's after its name, as graf_impact.
          const name = block["name"]
            .replace(`mcp__${SERVER}__`, "")
            .replace(/^mcp__(.+?)__/u, "$1_");
          return [{ kind: "tool", name, input: record(block["input"]) ?? {} }];
        }
        return [];
      });
    }
    case "result": {
      const cost = message["total_cost_usd"];
      const said = message["result"];
      return [
        {
          kind: "turn",
          costUsd: typeof cost === "number" ? cost : null,
          failed:
            message["is_error"] === true
              ? typeof said === "string" && said.trim() !== ""
                ? said
                : String(message["subtype"] ?? "it stopped")
              : null,
        },
      ];
    }
    default:
      return [];
  }
}

export interface ClaudeCodeOptions {
  /** The program to run; `claude` on PATH unless config says otherwise. */
  readonly command: string;
  /** XueFu's environment, filtered before Claude Code sees it. */
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly graceMs?: number;
}

/** Runs Claude Code headless, one process a conversation, talking stream JSON on its stdio. */
export function claudeCode(options: ClaudeCodeOptions): AgentRunner {
  const graceMs = options.graceMs ?? DEFAULT_GRACE_MS;
  return {
    id: "claude",
    name: "Claude",
    models: () => Promise.resolve(ok(MODELS)),
    // Claude Code asks XueFu's approval tool, never its client.
    start(launch, onEvent) {
      let child: Bun.Subprocess<"pipe", "pipe", "pipe">;
      try {
        child = Bun.spawn([options.command, ...claudeArgs(launch)], {
          cwd: launch.cwd,
          env: agentEnvironment(options.env),
          stdin: "pipe",
          stdout: "pipe",
          stderr: "pipe",
        });
      } catch (thrown) {
        return err(
          processError(`Unable to run ${options.command}`, options.command, null, {
            cause: thrown,
            hint: "Check that Claude Code is installed and on your PATH: https://claude.com/claude-code",
          }),
        );
      }
      let stopped = false;
      const send = (text: string) => {
        if (stopped) return;
        try {
          child.stdin.write(userMessage(text));
          child.stdin.flush();
        } catch {
          // It has gone; its exit says why.
        }
      };
      const stderr = new Response(child.stderr).text();
      void (async () => {
        for await (const line of lines(child.stdout)) {
          for (const event of claudeEvents(line)) onEvent(event);
        }
        const code = await child.exited;
        const said = (await stderr).trim().split("\n").at(-1) ?? "";
        onEvent({
          kind: "exit",
          message:
            stopped || code === 0 ? null : said === "" ? `Claude Code stopped (${code})` : said,
        });
      })();
      send(launch.prompt);
      const session: AgentSession = {
        send,
        stop: () => {
          if (stopped) return;
          stopped = true;
          child.kill("SIGTERM");
          setTimeout(() => child.kill("SIGKILL"), graceMs).unref();
        },
      };
      return ok(session);
    },
  };
}
