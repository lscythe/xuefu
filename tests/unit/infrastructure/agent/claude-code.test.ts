import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AgentEvent, AgentLaunch } from "../../../../src/application/ports/agent";
import type { AbsolutePath } from "../../../../src/domain/shared/path";
import {
  agentEnvironment,
  claudeArgs,
  claudeCode,
  claudeEvents,
  userMessage,
} from "../../../../src/infrastructure/agent/claude-code";
import { makeTempDir } from "../../../support/temp-dir";

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

const LAUNCH: AgentLaunch = {
  cwd: "/tmp" as AbsolutePath,
  prompt: "Review MOB/app#42",
  instructions: "You are inside XueFu.",
  mcp: { url: "http://127.0.0.1:4321/mcp", token: "t0ken" },
  readTools: ["pr_diff", "pr_comments"],
  approvalTool: "approval",
  servers: [],
};

const line = (message: object) => JSON.stringify(message);

describe("claudeArgs", () => {
  test("headless, stream JSON both ways, XueFu's tools alone, reads free, the rest asked", () => {
    const args = claudeArgs(LAUNCH, null);
    const after = (flag: string) => args[args.indexOf(flag) + 1];
    expect(args.slice(0, 6)).toEqual([
      "-p",
      "--input-format",
      "stream-json",
      "--output-format",
      "stream-json",
      "--verbose",
    ]);
    expect(JSON.parse(after("--mcp-config") ?? "")).toEqual({
      mcpServers: {
        xuefu: {
          type: "http",
          url: "http://127.0.0.1:4321/mcp",
          headers: { Authorization: "Bearer t0ken" },
        },
      },
    });
    expect(args).toContain("--strict-mcp-config");
    expect(args).toContain("--no-session-persistence");
    expect(after("--tools")).toBe("Read,Grep,Glob");
    expect(after("--allowedTools")).toBe("mcp__xuefu__pr_diff,mcp__xuefu__pr_comments");
    expect(after("--permission-prompt-tool")).toBe("mcp__xuefu__approval");
    expect(after("--append-system-prompt")).toBe("You are inside XueFu.");
    // Nothing bypasses asking.
    expect(args.join(" ")).not.toContain("bypass");
    expect(args).not.toContain("--model");
    expect(claudeArgs(LAUNCH, "opus").slice(-2)).toEqual(["--model", "opus"]);
  });

  test("the read-only servers it is given run over stdio, every tool of theirs free", () => {
    const args = claudeArgs(
      {
        ...LAUNCH,
        servers: [{ name: "graf", command: "/bin/graf", args: ["serve", "--db", "/g"] }],
      },
      null,
    );
    const after = (flag: string) => args[args.indexOf(flag) + 1];
    expect(JSON.parse(after("--mcp-config") ?? "").mcpServers.graf).toEqual({
      type: "stdio",
      command: "/bin/graf",
      args: ["serve", "--db", "/g"],
    });
    expect(after("--allowedTools")).toBe("mcp__xuefu__pr_diff,mcp__xuefu__pr_comments,mcp__graf");
  });
});

describe("claudeEvents", () => {
  test("its start, what it says, the tools it uses, and the end of each answer", () => {
    expect(
      claudeEvents(line({ type: "system", subtype: "init", model: "claude-opus-5-5" })),
    ).toEqual([{ kind: "ready", model: "claude-opus-5-5" }]);
    expect(claudeEvents(line({ type: "system", subtype: "init" }))).toEqual([
      { kind: "ready", model: null },
    ]);
    expect(
      claudeEvents(
        line({
          type: "assistant",
          message: {
            content: [
              { type: "thinking", thinking: "hmm" },
              { type: "text", text: "Reading the diff." },
              { type: "text", text: "  " },
              { type: "tool_use", id: "t1", name: "mcp__xuefu__pr_diff", input: { stat: true } },
              { type: "tool_use", id: "t2", name: "Read", input: "not an object" },
              { type: "tool_use", id: "t3", name: "mcp__graf__get_node", input: { id: "x" } },
              null,
            ],
          },
        }),
      ),
    ).toEqual([
      { kind: "text", text: "Reading the diff." },
      { kind: "tool", name: "pr_diff", input: { stat: true } },
      { kind: "tool", name: "Read", input: {} },
      { kind: "tool", name: "graf_get_node", input: { id: "x" } },
    ]);
    expect(
      claudeEvents(line({ type: "result", is_error: false, result: "ok", total_cost_usd: 0.04 })),
    ).toEqual([{ kind: "turn", costUsd: 0.04, failed: null }]);
    expect(
      claudeEvents(line({ type: "result", is_error: true, result: "Credit balance is too low" })),
    ).toEqual([{ kind: "turn", costUsd: null, failed: "Credit balance is too low" }]);
    expect(
      claudeEvents(line({ type: "result", is_error: true, subtype: "error_max_turns" })),
    ).toEqual([{ kind: "turn", costUsd: null, failed: "error_max_turns" }]);
    expect(claudeEvents(line({ type: "result", is_error: true }))).toEqual([
      { kind: "turn", costUsd: null, failed: "it stopped" },
    ]);
  });

  test("lines it does not use, and lines that are not JSON, say nothing", () => {
    expect(claudeEvents(line({ type: "system", subtype: "hook_started" }))).toEqual([]);
    expect(claudeEvents(line({ type: "user", message: { content: [] } }))).toEqual([]);
    expect(claudeEvents(line({ type: "assistant", message: { content: "text" } }))).toEqual([]);
    expect(claudeEvents("[1, 2]")).toEqual([]);
    expect(claudeEvents("not json")).toEqual([]);
  });
});

describe("userMessage", () => {
  test("a line of stream JSON, as the user's", () => {
    expect(userMessage("What changed?")).toBe(
      '{"type":"user","message":{"role":"user","content":"What changed?"}}\n',
    );
  });
});

describe("agentEnvironment", () => {
  test("the usual allow-list, Claude Code's own settings and the proxy; never XueFu's secrets", () => {
    expect(
      agentEnvironment({
        PATH: "/usr/bin",
        HOME: "/home/fox",
        ANTHROPIC_API_KEY: "sk-ant",
        CLAUDE_CONFIG_DIR: "/home/fox/.claude",
        AWS_REGION: "us-east-1",
        HTTPS_PROXY: "http://proxy:8080",
        NODE_EXTRA_CA_CERTS: "/etc/ca.pem",
        BITBUCKET_TOKEN: "BBDC-secret",
        JIRA_TOKEN: "secret",
        UNSET: undefined,
      }),
    ).toEqual({
      PATH: "/usr/bin",
      HOME: "/home/fox",
      ANTHROPIC_API_KEY: "sk-ant",
      CLAUDE_CONFIG_DIR: "/home/fox/.claude",
      AWS_REGION: "us-east-1",
      HTTPS_PROXY: "http://proxy:8080",
      NODE_EXTRA_CA_CERTS: "/etc/ca.pem",
    });
  });
});

/**
 * A stand-in for Claude Code: it reports its arguments and every message it reads, answering
 * each as Claude Code would; "fail" makes it stop with an error, "hang" ignores stopping politely.
 */
const FAKE = `#!/usr/bin/env bun
const say = (message) => console.log(JSON.stringify(message));
say({ type: "system", subtype: "init", model: "fake-model" });
say({ type: "assistant", message: { content: [{ type: "text", text: "args " + JSON.stringify(process.argv.slice(2, 3)) + " in " + process.cwd() }] } });
if (process.env.BITBUCKET_TOKEN !== undefined) say({ type: "assistant", message: { content: [{ type: "text", text: "LEAKED" }] } });
let buffer = "";
for await (const chunk of Bun.stdin.stream()) {
  buffer += new TextDecoder().decode(chunk);
  const lines = buffer.split("\\n");
  buffer = lines.pop();
  for (const line of lines) {
    const text = JSON.parse(line).message.content;
    if (text === "fail") {
      console.error("starting up\\nInvalid API key");
      process.exit(3);
    }
    if (text === "hang") process.on("SIGTERM", () => {});
    say({ type: "assistant", message: { content: [{ type: "tool_use", name: "mcp__xuefu__pr_diff", input: {} }, { type: "text", text: "you said " + text }] } });
    say({ type: "result", is_error: false, result: "", total_cost_usd: 0.01 });
  }
}
`;

function fakeClaude(): { command: string; cwd: AbsolutePath } {
  const dir = makeTempDir("xuefu-claude-");
  cleanups.push(dir.cleanup);
  const command = join(dir.path, "claude");
  writeFileSync(command, FAKE);
  chmodSync(command, 0o755);
  return { command, cwd: realpathSync(dir.path) as AbsolutePath };
}

/** For a conversation that needs nothing done as it goes. */
const ignore = () => undefined;

/** Runs the fake on the first message, then whatever `then` does as events come in. */
function converse(
  first: string,
  then: (event: AgentEvent, session: { send(text: string): void; stop(): void }) => void,
  options: { graceMs?: number; command?: string } = {},
) {
  const fake = fakeClaude();
  const events: AgentEvent[] = [];
  const { promise: exited, resolve } = Promise.withResolvers<AgentEvent[]>();
  const runner = claudeCode({
    command: options.command ?? fake.command,
    env: { ...process.env, BITBUCKET_TOKEN: "BBDC-secret" },
    model: null,
    ...(options.graceMs === undefined ? {} : { graceMs: options.graceMs }),
  });
  let session: { send(text: string): void; stop(): void } | null = null;
  const started = runner.start({ ...LAUNCH, cwd: fake.cwd, prompt: first }, (event) => {
    events.push(event);
    if (event.kind === "exit") resolve(events);
    else if (session !== null) then(event, session);
  });
  if (started.ok) session = started.value;
  return { runner, started, exited, cwd: fake.cwd };
}

describe("claudeCode", () => {
  test("runs Claude Code in the folder, sends the first message, then each one after", async () => {
    let turns = 0;
    const { runner, exited, cwd } = converse("hello", (event, session) => {
      if (event.kind !== "turn") return;
      turns += 1;
      if (turns === 1) session.send("again");
      else session.stop();
    });
    expect(runner.name).toBe("Claude");
    const events = await exited;
    expect(events).toEqual([
      { kind: "ready", model: "fake-model" },
      { kind: "text", text: `args ["-p"] in ${cwd}` },
      { kind: "tool", name: "pr_diff", input: {} },
      { kind: "text", text: "you said hello" },
      { kind: "turn", costUsd: 0.01, failed: null },
      { kind: "tool", name: "pr_diff", input: {} },
      { kind: "text", text: "you said again" },
      { kind: "turn", costUsd: 0.01, failed: null },
      // Stopped when asked: no reason to give.
      { kind: "exit", message: null },
    ]);
  });

  test("an agent that stops on its own says why, from the last thing it wrote", async () => {
    const { exited } = converse("fail", ignore);
    expect((await exited).at(-1)).toEqual({ kind: "exit", message: "Invalid API key" });
  });

  test("one that will not stop is killed; sending to it then does nothing", async () => {
    const { exited } = converse(
      "hang",
      (event, session) => {
        if (event.kind !== "turn") return;
        session.stop();
        session.stop();
        session.send("ignored");
      },
      { graceMs: 50 },
    );
    const events = await exited;
    expect(events.at(-1)).toEqual({ kind: "exit", message: null });
    expect(events.filter((event) => event.kind === "turn")).toHaveLength(1);
  });

  test("a program that is not there cannot start", () => {
    const { started } = converse("hello", ignore, { command: "/nonexistent/claude" });
    expect(started.ok).toBe(false);
    if (!started.ok) {
      expect(started.error.message).toBe("Unable to run /nonexistent/claude");
      expect(started.error.hint).toContain("Claude Code is installed");
    }
  });
});
