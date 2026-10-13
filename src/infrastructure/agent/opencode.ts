import type {
  AgentLaunch,
  AgentModel,
  AgentRunner,
  AgentSession,
} from "../../application/ports/agent";
import type { ConfirmationPrompt } from "../../domain/shared/confirmation";
import { processError } from "../../domain/shared/errors";
import type { AbsolutePath } from "../../domain/shared/path";
import { err, ok } from "../../domain/shared/result";
import { childEnvironment } from "../process/bun-process-runner";
import { type AcpConnection, acpConnection, record } from "./acp";

/** What XueFu's MCP server is called in the session, so its tools are `xuefu_<name>`. */
const SERVER = "xuefu";
/** OpenCode's agent that reads and plans, and changes nothing. */
const READ_ONLY_MODE = "plan";
/** How long a stopped agent gets to close its session, and then between SIGTERM and SIGKILL. */
const DEFAULT_GRACE_MS = 2000;
/** Long enough to start OpenCode and read its providers' models. */
const LIST_TIMEOUT_MS = 30_000;
/** Longest a value is shown when asking, so the dialog stays a dialog. */
const MAX_VALUE = 160;
const INSTALL_HINT = "Check that OpenCode is installed and on your PATH: https://opencode.ai";

/** What OpenCode needs beyond what every child gets: its own settings, providers and proxy. */
const PASSED_PREFIXES = [
  "OPENCODE_",
  "ANTHROPIC_",
  "OPENAI_",
  "OPENROUTER_",
  "GOOGLE_",
  "GEMINI_",
  "VERTEX_",
  "AWS_",
  "AZURE_",
  "GROQ_",
  "MISTRAL_",
  "DEEPSEEK_",
  "XAI_",
  "OLLAMA_",
];
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

/**
 * OpenCode's config for XueFu's sessions: the user's own, if any, with file edits refused and
 * commands asked first, as a review reads and changes nothing but through XueFu.
 */
export function reviewConfig(own: string | undefined): string {
  let config: Readonly<Record<string, unknown>> = {};
  try {
    config = record(JSON.parse(own ?? "{}")) ?? {};
  } catch {
    // Not JSON: OpenCode would refuse it too, so it is left out.
  }
  const permission = record(config["permission"]) ?? {};
  return JSON.stringify({ ...config, permission: { ...permission, edit: "deny", bash: "ask" } });
}

/** The environment OpenCode runs in: the usual allow-list, its providers' settings, and keys. */
export function openCodeEnvironment(
  parent: Readonly<Record<string, string | undefined>>,
): Record<string, string> {
  const own: Record<string, string> = {};
  for (const [name, value] of Object.entries(parent)) {
    if (value === undefined) continue;
    if (
      PASSED.has(name) ||
      name.endsWith("_API_KEY") ||
      PASSED_PREFIXES.some((prefix) => name.startsWith(prefix))
    ) {
      own[name] = value;
    }
  }
  return childEnvironment(parent, {
    ...own,
    OPENCODE_CONFIG_CONTENT: reviewConfig(parent["OPENCODE_CONFIG_CONTENT"]),
  });
}

/** XueFu's tools over HTTP behind the session's token, and the read-only servers over stdio. */
export function mcpServers(launch: AgentLaunch): object[] {
  return [
    {
      type: "http",
      name: SERVER,
      url: launch.mcp.url,
      headers: [{ name: "Authorization", value: `Bearer ${launch.mcp.token}` }],
    },
    ...launch.servers.map((server) => ({
      name: server.name,
      command: server.command,
      args: [...server.args],
      env: [],
    })),
  ];
}

/** One line of at most `MAX_VALUE` columns, for a value the user is asked about. */
function shown(value: unknown): string {
  const text = (typeof value === "string" ? value : JSON.stringify(value)).replace(/\s+/gu, " ");
  return text.length > MAX_VALUE ? `${text.slice(0, MAX_VALUE - 1)}…` : text;
}

/** What the user is asked before OpenCode uses a tool of its own, such as running a command. */
export function permissionPrompt(params: unknown): ConfirmationPrompt {
  const call = record(record(params)?.["toolCall"]);
  const title = typeof call?.["title"] === "string" ? call["title"] : "a tool";
  const details = Object.entries(record(call?.["rawInput"]) ?? {}).map(([label, value]) => ({
    label,
    value: shown(value),
  }));
  return {
    title: `Let OpenCode use ${title}`,
    severity: "confirm",
    details: details.length === 0 ? [{ label: "With", value: "nothing" }] : details,
    consequence: `OpenCode uses its ${title} tool with what is shown, this once.`,
    confirmLabel: "Allow",
  };
}

/** The option OpenCode offered for the user's answer, once: never "always". */
export function permissionOutcome(params: unknown, allowed: boolean): object {
  const options = record(params)?.["options"];
  const offered = (Array.isArray(options) ? options : []).flatMap((option) => {
    const one = record(option);
    return one === null ? [] : [one];
  });
  const kind = allowed ? "allow_once" : "reject_once";
  const picked = offered.find((option) => option["kind"] === kind);
  return picked === undefined
    ? { outcome: { outcome: "cancelled" } }
    : { outcome: { outcome: "selected", optionId: picked["optionId"] } };
}

/** Why a turn ended, when it did not end as it should. */
export function stopFailure(reason: unknown): string | null {
  switch (reason) {
    case "end_turn":
    case "cancelled":
      return null;
    case "max_tokens":
      return "It ran out of room for its answer.";
    case "max_turn_requests":
      return "It used up the requests it may make in one answer.";
    case "refusal":
      return "It refused to answer.";
    default:
      return `It stopped: ${String(reason)}`;
  }
}

/** A session's options of one kind, such as its models, as OpenCode lists them. */
function optionsOf(session: unknown, id: string) {
  const options = record(session)?.["configOptions"];
  const option = (Array.isArray(options) ? options : [])
    .map(record)
    .find((one) => one?.["id"] === id);
  const values = option?.["options"];
  return {
    current: typeof option?.["currentValue"] === "string" ? option["currentValue"] : null,
    values: (Array.isArray(values) ? values : []).flatMap((value) => {
      const one = record(value);
      return typeof one?.["value"] === "string"
        ? [{ id: one["value"], name: typeof one["name"] === "string" ? one["name"] : one["value"] }]
        : [];
    }),
  };
}

/** Starts the conversation: what the agent is, then a session in `cwd` with `servers`. */
async function openSession(
  rpc: AcpConnection,
  cwd: string,
  servers: readonly object[],
): Promise<{ readonly id: string; readonly session: unknown } | string> {
  const started = await rpc.call("initialize", {
    protocolVersion: 1,
    clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
    clientInfo: { name: "xuefu", version: "1" },
  });
  if (!started.ok) return `OpenCode could not start: ${started.message}`;
  const made = await rpc.call("session/new", { cwd, mcpServers: servers });
  const id = made.ok ? record(made.value)?.["sessionId"] : undefined;
  if (!made.ok || typeof id !== "string") {
    return `OpenCode could not start a session: ${made.ok ? "it gave no id" : made.message}`;
  }
  return { id, session: made.value };
}

export interface OpenCodeOptions {
  /** The program to run, `opencode` as found on PATH or where its installer puts it. */
  readonly command: string;
  /** XueFu's environment, filtered before OpenCode sees it. */
  readonly env: Readonly<Record<string, string | undefined>>;
  /** An empty folder of XueFu's, where OpenCode is asked which models it has. */
  readonly scratch: AbsolutePath;
  readonly graceMs?: number;
}

/**
 * Runs OpenCode through the Agent Client Protocol, one process a conversation, in its read-only
 * plan mode. It reaches XueFu's tools over HTTP, which asks the user before any change; what it
 * would do with its own tools, such as run a command, it asks the user here. Its session is
 * deleted when it stops, so it stays out of OpenCode's own history.
 */
export function openCode(options: OpenCodeOptions): AgentRunner {
  const graceMs = options.graceMs ?? DEFAULT_GRACE_MS;
  const spawn = (cwd: string) =>
    Bun.spawn([options.command, "acp"], {
      cwd,
      env: openCodeEnvironment(options.env),
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });
  const cannotRun = (thrown: unknown) =>
    err(
      processError(`Unable to run ${options.command}`, options.command, null, {
        cause: thrown,
        hint: INSTALL_HINT,
      }),
    );

  return {
    id: "opencode",
    name: "OpenCode",

    async models(signal) {
      let child: ReturnType<typeof spawn>;
      try {
        child = spawn(options.scratch);
      } catch (thrown) {
        return cannotRun(thrown);
      }
      const rpc = acpConnection(child, {
        request: () => Promise.resolve(null),
        notify: () => undefined,
      });
      const listing = (async () => {
        const opened = await openSession(rpc, options.scratch, []);
        if (typeof opened === "string") return opened;
        await rpc.call("session/delete", { sessionId: opened.id });
        return optionsOf(opened.session, "model");
      })();
      const stop = new Promise<string>((resolve) => {
        const timer = setTimeout(
          () => resolve("OpenCode did not list its models in time"),
          LIST_TIMEOUT_MS,
        );
        timer.unref();
        signal?.addEventListener("abort", () => resolve("Listing OpenCode's models was cancelled"));
      });
      const listed = await Promise.race([listing, stop]);
      child.kill();
      if (typeof listed === "string") return err(processError(listed, options.command, null));
      const ownDefault = listed.current === null ? "" : ` (${listed.current})`;
      const models: AgentModel[] = [
        { id: null, name: `OpenCode's default${ownDefault}` },
        ...listed.values,
      ];
      return ok(models);
    },

    start(launch, onEvent, approve) {
      let child: ReturnType<typeof spawn>;
      try {
        child = spawn(launch.cwd);
      } catch (thrown) {
        return cannotRun(thrown);
      }
      let stopped = false;
      /** Why it was stopped before it could start, said when it exits. */
      let failure: string | null = null;
      /** What it says, in pieces, until a tool or the end of its answer. */
      let saying = "";
      /** What it has spent in the session, in dollars, when it says. */
      let cost: number | null = null;
      /** Each tool it uses by its call, until it is shown with what it was passed. */
      const calls = new Map<string, { readonly name: string; shown: boolean }>();

      const said = () => {
        if (saying.trim() !== "") onEvent({ kind: "text", text: saying });
        saying = "";
      };
      const used = (id: string, input: unknown) => {
        const call = calls.get(id);
        if (call === undefined || call.shown) return;
        call.shown = true;
        said();
        onEvent({ kind: "tool", name: call.name, input: record(input) ?? {} });
      };
      const update = (params: unknown) => {
        const change = record(record(params)?.["update"]);
        const id = typeof change?.["toolCallId"] === "string" ? change["toolCallId"] : "";
        const input = record(change?.["rawInput"]);
        const filled = input !== null && Object.keys(input).length > 0;
        switch (change?.["sessionUpdate"]) {
          case "agent_message_chunk": {
            const content = record(change["content"]);
            if (content?.["type"] === "text" && typeof content["text"] === "string") {
              saying += content["text"];
            }
            return;
          }
          case "tool_call": {
            const title = typeof change["title"] === "string" ? change["title"] : "tool";
            // XueFu's tools by their own names, as Claude's are shown; others as OpenCode names them.
            calls.set(id, { name: title.replace(`${SERVER}_`, ""), shown: false });
            if (filled) used(id, input);
            return;
          }
          case "tool_call_update":
            // What it passed often follows the call; shown once known, or once it is done.
            if (filled || change["status"] === "completed" || change["status"] === "failed") {
              used(id, input);
            }
            return;
          case "usage_update": {
            const spent = record(change["cost"]);
            if (typeof spent?.["amount"] === "number" && spent["currency"] === "USD") {
              cost = spent["amount"];
            }
            return;
          }
          default:
            return;
        }
      };

      const rpc = acpConnection(child, {
        request: async (method, params) =>
          method === "session/request_permission"
            ? permissionOutcome(params, await approve(permissionPrompt(params)))
            : null,
        notify: (method, params) => {
          if (method === "session/update") update(params);
        },
      });

      const opened = (async (): Promise<string | null> => {
        const session = await openSession(rpc, launch.cwd, mcpServers(launch));
        if (typeof session === "string") {
          failure = session;
          child.kill();
          return null;
        }
        const modes = optionsOf(session.session, "mode");
        if (modes.values.some((mode) => mode.id === READ_ONLY_MODE)) {
          await rpc.call("session/set_config_option", {
            sessionId: session.id,
            configId: "mode",
            value: READ_ONLY_MODE,
          });
        }
        if (launch.model !== null) {
          const set = await rpc.call("session/set_config_option", {
            sessionId: session.id,
            configId: "model",
            value: launch.model,
          });
          if (!set.ok) {
            failure = `OpenCode cannot use ${launch.model}: ${set.message}`;
            child.kill();
            return null;
          }
        }
        onEvent({
          kind: "ready",
          model: launch.model ?? optionsOf(session.session, "model").current,
        });
        return session.id;
      })();

      /** Messages go one at a time, each once the one before is answered. */
      let queue: Promise<unknown> = opened;
      let first = true;
      const send = (text: string) => {
        queue = queue.then(async () => {
          const sessionId = await opened;
          if (sessionId === null || stopped) return;
          // OpenCode takes no instructions of its own, so they come before the first message.
          const prompt = first
            ? [
                { type: "text", text: launch.instructions },
                { type: "text", text },
              ]
            : [{ type: "text", text }];
          first = false;
          const answered = await rpc.call("session/prompt", { sessionId, prompt });
          said();
          if (stopped) return;
          onEvent({
            kind: "turn",
            costUsd: cost,
            failed: answered.ok
              ? stopFailure(record(answered.value)?.["stopReason"])
              : answered.message,
          });
        });
      };

      const stderr = new Response(child.stderr).text();
      void (async () => {
        const code = await child.exited;
        const last = (await stderr).trim().split("\n").at(-1) ?? "";
        onEvent({
          kind: "exit",
          message: stopped
            ? null
            : (failure ?? (code === 0 ? null : last === "" ? `OpenCode stopped (${code})` : last)),
        });
      })();
      send(launch.prompt);

      const session: AgentSession = {
        send,
        stop: () => {
          if (stopped) return;
          stopped = true;
          void (async () => {
            const sessionId = await Promise.race([opened, Bun.sleep(graceMs).then(() => null)]);
            if (sessionId !== null) {
              rpc.notify("session/cancel", { sessionId });
              await Promise.race([rpc.call("session/delete", { sessionId }), Bun.sleep(graceMs)]);
            }
            child.kill("SIGTERM");
            setTimeout(() => child.kill("SIGKILL"), graceMs).unref();
          })();
        },
      };
      return ok(session);
    },
  };
}
