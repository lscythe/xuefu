import type {
  AgentEvent,
  AgentHandlers,
  AgentHost,
  AgentLaunch,
  AgentRunner,
  AgentServer,
  AgentSession,
} from "../application/ports/agent";
import type { Clock } from "../application/ports/clock";
import type {
  CodeGraph,
  CodeGraphSetup,
  ProjectBrief,
  ProjectBriefs,
} from "../application/ports/project-context";
import { type McpTools, mcpReply } from "../cli/mcp-server";
import type { McpTool } from "../cli/mcp-tools";
import type { ConfirmationPrompt } from "../domain/shared/confirmation";
import type { AbsolutePath } from "../domain/shared/path";
import { briefAge, freshBrief, INSTRUCTIONS, instructionsFor, studyPrompt } from "./agent-context";
import { canPost, draftReview, POST, POST_TOOL, postReview } from "./review-post";

/** The tool Claude Code asks before using any other, as `--permission-prompt-tool`. */
const APPROVAL = "approval";
/** How a tool of XueFu's is named to the agent. */
const OURS = "mcp__xuefu__";
/** Longest a value is shown when asking, so the dialog stays a dialog. */
const MAX_VALUE = 160;

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

export interface AgentHostOptions {
  readonly runner: AgentRunner;
  readonly tools: McpTools;
  /** Keeps a graph of each workspace's code for the agent; null when graf is not installed. */
  readonly graph: CodeGraph | null;
  /** Offers to install graf when it is not; null when there is nothing to offer. */
  readonly setup: CodeGraphSetup | null;
  /** What the agent learned of each workspace, kept between conversations. */
  readonly briefs: ProjectBriefs;
  /** An empty folder the agent works in when no workspace holds the code it is asked about. */
  readonly elsewhere: AbsolutePath;
  readonly clock: Clock;
}

/** How a run of the agent on one prompt ended: its last words, what it cost, or why it failed. */
interface Studied {
  readonly text: string | null;
  readonly costUsd: number | null;
  readonly failed: string | null;
}

const spent = (cost: number | null) => (cost === null ? "" : `, $${cost.toFixed(2)}`);

/** What the user is asked before the code graph's tool is installed. */
function installPrompt(agent: string, setup: CodeGraphSetup): ConfirmationPrompt {
  return {
    title: `Install ${setup.name}`,
    severity: "confirm",
    details: [
      { label: "Runs", value: setup.command },
      { label: "About", value: setup.url },
    ],
    consequence:
      `${setup.name} keeps a graph of each workspace's code on this machine, so ${agent} can ` +
      "follow what calls what and what a change affects. Without it, " +
      `${agent} studies the code by reading it, and you are not asked again.`,
    confirmLabel: "Install",
  };
}

/**
 * Serves XueFu's tools to agents the cockpit starts, and prepares what they know first. Each
 * session gets its own MCP endpoint on 127.0.0.1, behind a token only that agent is given, and
 * gone when it ends. The agent's reads run freely; anything else is put to the user first, and a
 * change runs only once they allow it.
 *
 * Before the conversation, the workspace's code graph is brought up to date, and the agent studies
 * the workspace once, writing itself a brief of its context and practices that every conversation
 * after starts from, until it is two weeks old.
 */
export function agentHost(options: AgentHostOptions): AgentHost {
  const { runner, tools } = options;
  /** The code graph, once graf is installed, by the user or from here. */
  let codeGraph = options.graph;
  /** Asked once a run at most, so a second conversation does not ask while the first does. */
  let offered = false;
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
    if (message?.["method"] === "tools/call" && params?.["name"] === POST && canPost(tools)) {
      // The user chooses what is posted in XueFu's own dialog, which is their approval of it.
      const draft = draftReview(params["arguments"]);
      const said =
        typeof draft === "string"
          ? draft
          : await postReview(tools, draft, await handlers.review(draft));
      return {
        jsonrpc: "2.0",
        id,
        result: {
          content: [{ type: "text", text: said }],
          ...(typeof draft === "string" ? { isError: true } : {}),
        },
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
    if (message?.["method"] === "tools/list" && Array.isArray(listed)) {
      listed.push(APPROVAL_TOOL, ...(canPost(tools) ? [POST_TOOL] : []));
    }
    return reply;
  };

  /** XueFu's MCP endpoint for one session, until it is stopped. */
  const serve = (handlers: AgentHandlers) => {
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
    return {
      mcp: { url: `http://127.0.0.1:${server.port}/mcp`, token },
      stop: () => void server.stop(true),
    };
  };

  return {
    name: runner.name,
    ask(question, handlers) {
      const { workspace } = question;
      const endpoint = serve(handlers);
      let ended = false;
      /** The agent at work now: studying the workspace, then the conversation. */
      let current: AgentSession | null = null;
      let conversation: AgentSession | null = null;
      /** What the user says while the agent is still preparing, sent once the conversation starts. */
      const waiting: string[] = [];
      const preparing = new AbortController();
      /** Events reach the cockpit until the session has ended, and never after. */
      const tell = (event: AgentEvent) => {
        if (!ended) handlers.onEvent(event);
      };
      const end = (message: string | null) => {
        if (ended) return;
        tell({ kind: "exit", message });
        ended = true;
        endpoint.stop();
      };
      const step = (text: string, failed = false) => tell({ kind: "step", text, failed });
      const launch = (prompt: string, instructions: string, servers: readonly AgentServer[]) => ({
        cwd: workspace?.path ?? options.elsewhere,
        prompt,
        instructions,
        mcp: endpoint.mcp,
        // Posting a review needs no approval of Claude Code's: XueFu's dialog asks the user.
        readTools: [
          ...tools.tools.filter((tool) => !tool.changes).map((tool) => tool.name),
          ...(canPost(tools) ? [POST] : []),
        ],
        approvalTool: APPROVAL,
        servers,
      });

      /** Runs the agent on one prompt, showing the tools it uses, until its answer is done. */
      const study = (studying: AgentLaunch) =>
        new Promise<Studied>((resolve) => {
          let last: string | null = null;
          const started = runner.start(studying, (event) => {
            if (event.kind === "tool") tell(event);
            else if (event.kind === "text") last = event.text;
            else if (event.kind === "turn") {
              current?.stop();
              resolve({
                text: event.failed === null ? last : null,
                costUsd: event.costUsd,
                failed: event.failed,
              });
            } else if (event.kind === "exit") {
              resolve({ text: null, costUsd: null, failed: event.message ?? "it stopped" });
            }
          });
          if (started.ok) current = started.value;
          else resolve({ text: null, costUsd: null, failed: started.error.message });
        });

      /** graf, installed now if the user agrees to it; null without it. */
      const offerGraph = async (setup: CodeGraphSetup): Promise<CodeGraph | null> => {
        offered = true;
        if (!(await handlers.approve(installPrompt(runner.name, setup)))) {
          const declined = setup.decline();
          step(
            declined.ok
              ? `Without ${setup.name}, ${runner.name} reads the code itself. To have it later: ${setup.url}`
              : `Without ${setup.name}; ${declined.error.message}`,
            !declined.ok,
          );
          return null;
        }
        step(`Installing ${setup.name}…`);
        const installed = await setup.install(preparing.signal);
        if (ended) return null;
        if (!installed.ok) {
          step(`${installed.error.message}: ${installed.error.hint ?? setup.url}`, true);
          return null;
        }
        step(`Installed ${setup.name}.`);
        codeGraph = installed.value;
        return codeGraph;
      };

      /** Starts the conversation itself, sending what the user said while it was prepared. */
      const converse = (prompt: string, instructions: string, servers: readonly AgentServer[]) => {
        const started = runner.start(launch(prompt, instructions, servers), (event) =>
          event.kind === "exit" ? end(event.message) : tell(event),
        );
        if (!started.ok) {
          end(started.error.message);
          return;
        }
        current = conversation = started.value;
        for (const text of waiting.splice(0)) conversation.send(text);
      };

      void (async () => {
        if (workspace === null) {
          // Nothing to graph or study: the code is reached through XueFu's tools.
          step(`No workspace holds this code, so ${runner.name} works from XueFu's tools alone.`);
          if (question.prompt === null) end(null);
          else
            converse(question.prompt, instructionsFor(null, null, false, options.clock.now()), []);
          return;
        }
        const servers: AgentServer[] = [];
        const setup = options.setup;
        const graph =
          codeGraph === null && setup !== null && !offered && !setup.declined()
            ? await offerGraph(setup)
            : codeGraph;
        if (ended) return;
        if (graph !== null) {
          const prepared = await graph.prepare(workspace, preparing.signal);
          if (ended) return;
          if (prepared.ok) {
            servers.push(prepared.value.server);
            step(
              prepared.value.created
                ? `Indexed ${prepared.value.files} files of ${workspace.name} into a code graph with graf.`
                : `The code graph of ${workspace.name} is up to date (${prepared.value.files} files).`,
            );
          } else {
            step(`No code graph: ${prepared.error.hint ?? prepared.error.message}`, true);
          }
        }
        const withGraph = servers.length > 0;

        const kept = options.briefs.find(workspace.id);
        if (!kept.ok)
          step(`What ${runner.name} learned could not be read: ${kept.error.message}`, true);
        let brief: ProjectBrief | null = kept.ok ? kept.value : null;
        const now = options.clock.now();
        if (question.prompt !== null && freshBrief(brief, now)) {
          step(`Using what ${runner.name} learned of ${workspace.name} ${briefAge(brief, now)}.`);
        } else {
          step(
            `Studying ${workspace.name} first; what ${runner.name} learns is kept for next time.`,
          );
          const studied = await study(launch(studyPrompt(withGraph), INSTRUCTIONS, servers));
          current = null;
          if (ended) return;
          if (studied.text === null) {
            step(`It could not study ${workspace.name}: ${studied.failed}`, true);
          } else {
            brief = {
              workspaceId: workspace.id,
              text: studied.text,
              createdAt: options.clock.now(),
            };
            const saved = options.briefs.save(brief);
            step(
              saved.ok
                ? `Learned ${workspace.name}${spent(studied.costUsd)}; kept for next time.`
                : `Learned ${workspace.name}, but it could not be kept: ${saved.error.message}`,
              !saved.ok,
            );
          }
          if (question.prompt === null) {
            if (studied.text !== null) tell({ kind: "text", text: studied.text });
            tell({ kind: "turn", costUsd: studied.costUsd, failed: null });
            end(null);
            return;
          }
        }

        const later = options.clock.now();
        converse(
          question.prompt,
          instructionsFor(workspace, freshBrief(brief, later) ? brief : null, withGraph, later),
          servers,
        );
      })();

      return {
        send: (text) => {
          if (conversation === null) waiting.push(text);
          else conversation.send(text);
        },
        stop: () => {
          preparing.abort();
          current?.stop();
          end(null);
        },
      };
    },
  };
}
