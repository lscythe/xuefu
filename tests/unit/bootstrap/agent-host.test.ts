import { describe, expect, test } from "bun:test";
import type {
  AgentEvent,
  AgentLaunch,
  AgentRunner,
  AgentSession,
} from "../../../src/application/ports/agent";
import { agentHost, approvalPrompt } from "../../../src/bootstrap/agent-host";
import type { McpTools } from "../../../src/cli/mcp-server";
import type { McpTool } from "../../../src/cli/mcp-tools";
import type { ConfirmationPrompt } from "../../../src/domain/shared/confirmation";
import { processError } from "../../../src/domain/shared/errors";
import type { AbsolutePath } from "../../../src/domain/shared/path";
import { err, ok } from "../../../src/domain/shared/result";

const DIFF: McpTool = {
  name: "pr_diff",
  description: "Show what a pull request changes, as a unified diff",
  parameters: { pullRequest: { type: "string", description: "the pull request" } },
  changes: false,
  argv: (values) => ["pr", "diff", "--", String(values["pullRequest"])],
};
const APPROVE: McpTool = {
  name: "pr_approve",
  description: "Approve a pull request",
  parameters: {
    pullRequest: { type: "string", description: "the pull request" },
    yes: { type: "boolean", description: "confirm without asking" },
  },
  changes: true,
  argv: (values) => ["pr", "approve", ...(values["yes"] === true ? ["--yes"] : [])],
};

describe("approvalPrompt", () => {
  test("XueFu's tool by its command and what it does, each argument; a flag by its meaning", () => {
    expect(
      approvalPrompt("Claude", [DIFF, APPROVE], "mcp__xuefu__pr_approve", {
        pullRequest: "MOB/app#42",
        yes: true,
      }),
    ).toEqual({
      title: "Let Claude run pr approve",
      severity: "confirm",
      details: [
        { label: "pullRequest", value: "MOB/app#42" },
        { label: "yes", value: "confirm without asking" },
      ],
      consequence:
        "Approve a pull request, as you, as xuefu pr approve would, without asking again.",
      confirmLabel: "Allow",
    });
    const needsWork = { ...APPROVE, name: "pr_needs_work" };
    expect(approvalPrompt("Claude", [needsWork], "mcp__xuefu__pr_needs_work", {}).title).toBe(
      "Let Claude run pr needs-work",
    );
  });

  test("another tool by its name; long or structured values on one short line", () => {
    const prompt = approvalPrompt("Claude", [DIFF], "Read", {
      file_path: "/etc/hosts",
      lines: { from: 1, to: 2 },
      note: `${"word ".repeat(40)}\nend`,
    });
    expect(prompt.title).toBe("Let Claude use Read");
    expect(prompt.consequence).toBe("Claude uses its Read tool with what is shown.");
    expect(prompt.details[1]).toEqual({ label: "lines", value: '{"from":1,"to":2}' });
    expect(prompt.details[2]?.value).toHaveLength(160);
    expect(prompt.details[2]?.value.endsWith("…")).toBe(true);
    expect(approvalPrompt("Claude", [], "Glob", {}).details).toEqual([
      { label: "With", value: "nothing" },
    ]);
  });
});

/** An agent that does nothing on its own: the test speaks for it, as its MCP client. */
function fakeRunner(fails = false) {
  const launches: AgentLaunch[] = [];
  const stopped: string[] = [];
  let emit: (event: AgentEvent) => void = () => undefined;
  const runner: AgentRunner = {
    name: "Claude",
    start(launch, onEvent) {
      if (fails) return err(processError("Unable to run claude", "claude", null));
      launches.push(launch);
      emit = onEvent;
      const session: AgentSession = {
        send: () => undefined,
        stop: () => stopped.push(launch.prompt),
      };
      return ok(session);
    },
  };
  return { runner, launches, stopped, emit: (event: AgentEvent) => emit(event) };
}

function tools(): McpTools & { ran: (readonly string[])[] } {
  const ran: (readonly string[])[] = [];
  return {
    version: "9.9.9",
    tools: [DIFF, APPROVE],
    ran,
    run: (argv) => {
      ran.push(argv);
      return Promise.resolve({ code: 0, stdout: `ran ${argv.join(" ")}\n`, stderr: "" });
    },
  };
}

/** Starts a session, answering approvals as `answers` says, and a way to call its endpoint. */
function session(answers: boolean[] = []) {
  const fake = fakeRunner();
  const served = tools();
  const asked: ConfirmationPrompt[] = [];
  const events: AgentEvent[] = [];
  const host = agentHost(fake.runner, served);
  const started = host.ask(
    { cwd: "/tmp" as AbsolutePath, prompt: "Review MOB/app#42" },
    {
      onEvent: (event) => events.push(event),
      approve: (prompt) => {
        asked.push(prompt);
        return Promise.resolve(answers.shift() ?? false);
      },
    },
  );
  const launch = fake.launches[0] as AgentLaunch;
  let id = 0;
  const post = (body: string, headers: Record<string, string> = {}) =>
    fetch(launch.mcp.url, {
      method: "POST",
      headers: { authorization: `Bearer ${launch.mcp.token}`, ...headers },
      body,
    });
  const rpc = async (method: string, params?: object) => {
    id += 1;
    const response = await post(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
    return response.json() as Promise<{ result: Record<string, unknown> }>;
  };
  const call = async (name: string, args: object) =>
    (await rpc("tools/call", { name, arguments: args })).result;
  return { host, fake, served, started, launch, asked, events, post, rpc, call };
}

const decision = (result: Record<string, unknown>) =>
  JSON.parse((result["content"] as { text: string }[])[0]?.text ?? "");

describe("agentHost", () => {
  test("starts the agent with its own endpoint, its reads free and the rest asked", async () => {
    const { host, started, launch, rpc, fake } = session();
    expect(host.name).toBe("Claude");
    expect(started.ok).toBe(true);
    expect(launch).toMatchObject({
      cwd: "/tmp",
      prompt: "Review MOB/app#42",
      readTools: ["pr_diff"],
      approvalTool: "approval",
    });
    expect(launch.mcp.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/mcp$/);
    expect(launch.instructions).toContain("pass yes set to true");

    const init = await rpc("initialize", { protocolVersion: "2025-06-18" });
    expect(init.result["instructions"]).toBe(launch.instructions);
    const listed = (await rpc("tools/list")).result["tools"] as { name: string }[];
    expect(listed.map((tool) => tool.name)).toEqual(["pr_diff", "pr_approve", "approval"]);
    fake.emit({ kind: "exit", message: null });
  });

  test("only the agent it started gets in, and only by POST to its endpoint", async () => {
    const { launch, post, fake } = session();
    const ping = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" });
    expect((await fetch(launch.mcp.url, { method: "POST", body: ping })).status).toBe(401);
    expect((await post(ping, { authorization: "Bearer guess" })).status).toBe(401);
    expect((await fetch(launch.mcp.url.replace("/mcp", "/other"))).status).toBe(404);
    const get = await fetch(launch.mcp.url, {
      headers: { authorization: `Bearer ${launch.mcp.token}` },
    });
    expect(get.status).toBe(405);
    expect(get.headers.get("allow")).toBe("POST");
    const note = await post(
      JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
    );
    expect(note.status).toBe(202);
    expect(await (await post("{oops")).json()).toMatchObject({ error: { code: -32700 } });
    fake.emit({ kind: "exit", message: null });
  });

  test("reads run freely; a change runs once the user allows it, and only that once", async () => {
    const { call, asked, served, fake, events } = session([true]);
    expect(await call("pr_diff", { pullRequest: "MOB/app#42" })).toMatchObject({ isError: false });

    // Not asked of the user first: refused.
    const unasked = await call("pr_approve", { pullRequest: "MOB/app#42", yes: true });
    expect(unasked).toEqual({
      content: [{ type: "text", text: "XueFu runs a change only once the user allows it." }],
      isError: true,
    });

    const input = { yes: true, pullRequest: "MOB/app#42" };
    const allowed = await call("approval", { tool_name: "mcp__xuefu__pr_approve", input });
    expect(decision(allowed)).toEqual({ behavior: "allow", updatedInput: input });
    expect(asked.map((prompt) => prompt.title)).toEqual(["Let Claude run pr approve"]);

    // The arguments in any order are the same call; it runs once.
    expect(await call("pr_approve", { pullRequest: "MOB/app#42", yes: true })).toMatchObject({
      isError: false,
    });
    expect(await call("pr_approve", { pullRequest: "MOB/app#42", yes: true })).toMatchObject({
      isError: true,
    });
    expect(served.ran).toEqual([
      ["pr", "diff", "--", "MOB/app#42"],
      ["pr", "approve", "--yes"],
    ]);

    fake.emit({ kind: "text", text: "Approved." });
    fake.emit({ kind: "exit", message: null });
    expect(events).toEqual([
      { kind: "text", text: "Approved." },
      { kind: "exit", message: null },
    ]);
  });

  test("a change the user declines is denied, with why, and does not run", async () => {
    const { call, served, fake } = session([false]);
    const denied = await call("approval", {
      tool_name: "mcp__xuefu__pr_approve",
      input: { pullRequest: "MOB/app#42" },
    });
    expect(decision(denied)).toEqual({ behavior: "deny", message: "The user did not allow it." });
    expect(await call("pr_approve", { pullRequest: "MOB/app#42" })).toMatchObject({
      isError: true,
    });
    // An approval with nothing in it asks about nothing in particular.
    const bare = await call("approval", {});
    expect(decision(bare).behavior).toBe("deny");
    expect(served.ran).toEqual([]);
    fake.emit({ kind: "exit", message: null });
  });

  test("its endpoint closes when the agent stops", async () => {
    const { launch, fake } = session();
    fake.emit({ kind: "exit", message: "Invalid API key" });
    await Bun.sleep(10);
    await expect(fetch(launch.mcp.url, { method: "POST", body: "{}" })).rejects.toThrow();
  });

  test("an agent that cannot start is said so, and nothing is left listening", () => {
    const fake = fakeRunner(true);
    const started = agentHost(fake.runner, tools()).ask(
      { cwd: "/tmp" as AbsolutePath, prompt: "hi" },
      { onEvent: () => undefined, approve: () => Promise.resolve(false) },
    );
    expect(started.ok).toBe(false);
    if (!started.ok) expect(started.error.message).toBe("Unable to run claude");
  });
});
