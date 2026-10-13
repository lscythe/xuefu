import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AgentEvent, AgentLaunch } from "../../../../src/application/ports/agent";
import type { ConfirmationPrompt } from "../../../../src/domain/shared/confirmation";
import type { AbsolutePath } from "../../../../src/domain/shared/path";
import {
  mcpServers,
  openCode,
  openCodeEnvironment,
  permissionOutcome,
  permissionPrompt,
  reviewConfig,
  stopFailure,
} from "../../../../src/infrastructure/agent/opencode";
import { makeTempDir } from "../../../support/temp-dir";

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

const LAUNCH: AgentLaunch = {
  cwd: "/tmp" as AbsolutePath,
  prompt: "hello",
  instructions: "You are inside XueFu.",
  mcp: { url: "http://127.0.0.1:4321/mcp", token: "t0ken" },
  readTools: ["pr_diff"],
  approvalTool: "approval",
  servers: [],
  model: null,
};

describe("reviewConfig", () => {
  test("the user's own config, with edits refused and commands asked", () => {
    expect(JSON.parse(reviewConfig(undefined))).toEqual({
      permission: { edit: "deny", bash: "ask" },
    });
    expect(
      JSON.parse(
        reviewConfig(
          JSON.stringify({ theme: "dark", permission: { webfetch: "allow", edit: "allow" } }),
        ),
      ),
    ).toEqual({ theme: "dark", permission: { webfetch: "allow", edit: "deny", bash: "ask" } });
    expect(JSON.parse(reviewConfig("{not json"))).toEqual({
      permission: { edit: "deny", bash: "ask" },
    });
  });
});

describe("openCodeEnvironment", () => {
  test("the usual allow-list, its providers and keys, and its config; never XueFu's secrets", () => {
    const env = openCodeEnvironment({
      PATH: "/usr/bin",
      OPENCODE_DISABLE_AUTOUPDATE: "1",
      ANTHROPIC_API_KEY: "sk-ant",
      MOONSHOT_API_KEY: "sk-moon",
      AWS_PROFILE: "work",
      HTTPS_PROXY: "http://proxy:8080",
      BITBUCKET_TOKEN: "BBDC-secret",
      JIRA_TOKEN: "secret",
      UNSET: undefined,
    });
    expect(env).toEqual({
      PATH: "/usr/bin",
      OPENCODE_DISABLE_AUTOUPDATE: "1",
      ANTHROPIC_API_KEY: "sk-ant",
      MOONSHOT_API_KEY: "sk-moon",
      AWS_PROFILE: "work",
      HTTPS_PROXY: "http://proxy:8080",
      OPENCODE_CONFIG_CONTENT: reviewConfig(undefined),
    });
  });
});

describe("mcpServers", () => {
  test("XueFu's over HTTP with its token, the graph's over stdio", () => {
    expect(
      mcpServers({ ...LAUNCH, servers: [{ name: "graf", command: "/bin/graf", args: ["serve"] }] }),
    ).toEqual([
      {
        type: "http",
        name: "xuefu",
        url: "http://127.0.0.1:4321/mcp",
        headers: [{ name: "Authorization", value: "Bearer t0ken" }],
      },
      { name: "graf", command: "/bin/graf", args: ["serve"], env: [] },
    ]);
  });
});

describe("permissions", () => {
  const ASKED = {
    toolCall: { title: "bash", rawInput: { command: "ls", note: `${"word ".repeat(40)}` } },
    options: [
      { optionId: "once", kind: "allow_once" },
      { optionId: "always", kind: "allow_always" },
      { optionId: "no", kind: "reject_once" },
      null,
    ],
  };

  test("the tool by its title, with what it is passed, on short lines", () => {
    const prompt = permissionPrompt(ASKED);
    expect(prompt.title).toBe("Let OpenCode use bash");
    expect(prompt.details[0]).toEqual({ label: "command", value: "ls" });
    expect(prompt.details[1]?.value).toHaveLength(160);
    expect(prompt.consequence).toBe("OpenCode uses its bash tool with what is shown, this once.");
    expect(permissionPrompt(null)).toMatchObject({
      title: "Let OpenCode use a tool",
      details: [{ label: "With", value: "nothing" }],
    });
  });

  test("allowed or not, only this once; with nothing to pick, cancelled", () => {
    expect(permissionOutcome(ASKED, true)).toEqual({
      outcome: { outcome: "selected", optionId: "once" },
    });
    expect(permissionOutcome(ASKED, false)).toEqual({
      outcome: { outcome: "selected", optionId: "no" },
    });
    expect(permissionOutcome({}, true)).toEqual({ outcome: { outcome: "cancelled" } });
  });
});

describe("stopFailure", () => {
  test("an answer that ended as it should is no failure; the rest say why", () => {
    expect(stopFailure("end_turn")).toBeNull();
    expect(stopFailure("cancelled")).toBeNull();
    expect(stopFailure("max_tokens")).toBe("It ran out of room for its answer.");
    expect(stopFailure("max_turn_requests")).toBe(
      "It used up the requests it may make in one answer.",
    );
    expect(stopFailure("refusal")).toBe("It refused to answer.");
    expect(stopFailure(undefined)).toBe("It stopped: undefined");
  });
});

/**
 * A stand-in for `opencode acp`: it logs what it is asked, and answers as OpenCode would. Told
 * "permission" it asks to run a command; "long" runs out of room; "fail" exits with an error.
 */
const FAKE = `#!/usr/bin/env bun
import { appendFileSync } from "node:fs";
const log = (entry) => appendFileSync(process.env.OPENCODE_FAKE_LOG, JSON.stringify(entry) + "\\n");
const send = (message) => console.log(JSON.stringify({ jsonrpc: "2.0", ...message }));
const update = (change) => send({ method: "session/update", params: { sessionId: "s1", update: change } });
const say = (text) => update({ sessionUpdate: "agent_message_chunk", content: { type: "text", text } });
const think = (text) => update({ sessionUpdate: "agent_thought_chunk", content: { type: "text", text } });
log({ leaked: process.env.BITBUCKET_TOKEN !== undefined, config: process.env.OPENCODE_CONFIG_CONTENT, cwd: process.cwd() });
const SESSION = {
  sessionId: "s1",
  configOptions: [
    { id: "mode", currentValue: "build", options: [{ value: "build", name: "Build" }, { value: "plan", name: "Plan" }] },
    { id: "model", currentValue: "anthropic/claude-sonnet", options: [{ value: "anthropic/claude-sonnet", name: "Claude Sonnet" }, { value: "openai/gpt-5" }, { name: "no value" }] },
  ],
};
let asking = null;
const answer = (message) => {
  const { id, method, params } = message;
  if (method === undefined) {
    say("answered " + JSON.stringify(message.result));
    send({ id: asking, result: { stopReason: "end_turn" } });
    return;
  }
  log({ method, params });
  switch (method) {
    case "initialize":
      if (process.env.OPENCODE_FAKE_HANG === undefined) send({ id, result: { protocolVersion: 1 } });
      return;
    case "session/new":
      if (process.env.OPENCODE_FAKE_BROKEN !== undefined) send({ id, error: { code: -32000, message: "no provider" } });
      else send({ id, result: SESSION });
      return;
    case "session/set_config_option":
      if (params.value === "nope/none") send({ id, error: { code: -32602, message: "model not found: nope/none" } });
      else send({ id, result: { configOptions: [] } });
      return;
    case "session/delete":
      send({ id, result: {} });
      return;
    case "session/prompt": {
      const text = params.prompt.at(-1).text;
      if (text === "fail") {
        console.error("starting\\nInvalid API key");
        process.exit(3);
      }
      if (text === "permission") {
        asking = id;
        send({ id: 99, method: "session/request_permission", params: { sessionId: "s1", toolCall: { title: "bash", rawInput: { command: "ls" } }, options: [{ optionId: "once", kind: "allow_once" }, { optionId: "always", kind: "allow_always" }, { optionId: "no", kind: "reject_once" }] } });
        return;
      }
      if (text === "long") {
        send({ id, result: { stopReason: "max_tokens" } });
        return;
      }
      think("Read ");
      think("the diff.");
      update({ sessionUpdate: "agent_thought_chunk", content: { type: "image", data: "" } });
      say("you said ");
      say(text + " in " + params.prompt.length + " blocks");
      update({ sessionUpdate: "tool_call", toolCallId: "t1", title: "xuefu_pr_diff", rawInput: {} });
      update({ sessionUpdate: "tool_call_update", toolCallId: "t1", rawInput: { pullRequest: "MOB/app#42" } });
      update({ sessionUpdate: "tool_call_update", toolCallId: "t1", status: "completed" });
      update({ sessionUpdate: "tool_call", toolCallId: "t2", title: "read" });
      update({ sessionUpdate: "tool_call_update", toolCallId: "t2", status: "completed" });
      update({ sessionUpdate: "usage_update", used: 10, size: 100, cost: { amount: 0.02, currency: "USD" } });
      update({ sessionUpdate: "plan", entries: [] });
      think("Nothing more to say.");
      send({ id, result: { stopReason: "end_turn" } });
      return;
    }
    default:
      if (id !== undefined) send({ id, error: { code: -32601, message: method + " is not supported" } });
  }
};
let buffer = "";
for await (const bytes of Bun.stdin.stream()) {
  buffer += new TextDecoder().decode(bytes);
  const lines = buffer.split("\\n");
  buffer = lines.pop();
  for (const line of lines) {
    console.log("not json");
    answer(JSON.parse(line));
  }
}
`;

/** The fake, in a folder of its own, logging to a file there. */
function fakeOpenCode(env: Record<string, string> = {}) {
  const dir = makeTempDir("xuefu-opencode-");
  cleanups.push(dir.cleanup);
  const command = join(dir.path, "opencode");
  writeFileSync(command, FAKE);
  chmodSync(command, 0o755);
  const log = join(dir.path, "log.jsonl");
  const runner = openCode({
    command,
    env: { ...process.env, ...env, BITBUCKET_TOKEN: "BBDC-secret", OPENCODE_FAKE_LOG: log },
    scratch: realpathSync(dir.path) as AbsolutePath,
    graceMs: 50,
  });
  const logged = (): Record<string, unknown>[] =>
    existsSync(log)
      ? readFileSync(log, "utf8")
          .trim()
          .split("\n")
          .map((line) => JSON.parse(line))
      : [];
  return { runner, cwd: realpathSync(dir.path) as AbsolutePath, logged };
}

/** For a conversation that needs nothing done as it goes. */
const ignore = () => undefined;

/** Starts the fake on the first message, then whatever `then` does as events come in. */
function converse(
  first: string,
  then: (event: AgentEvent, session: { send(text: string): void; stop(): void }) => void,
  options: { model?: string; answer?: boolean; env?: Record<string, string> } = {},
) {
  const fake = fakeOpenCode(options.env);
  const events: AgentEvent[] = [];
  const asked: ConfirmationPrompt[] = [];
  const { promise: exited, resolve } = Promise.withResolvers<AgentEvent[]>();
  let session: { send(text: string): void; stop(): void } | null = null;
  const started = fake.runner.start(
    { ...LAUNCH, cwd: fake.cwd, prompt: first, model: options.model ?? null },
    (event) => {
      events.push(event);
      if (event.kind === "exit") resolve(events);
      else if (session !== null) then(event, session);
    },
    (prompt) => {
      asked.push(prompt);
      return Promise.resolve(options.answer ?? false);
    },
  );
  if (started.ok) session = started.value;
  return { ...fake, started, exited, asked };
}

describe("openCode", () => {
  test("its models are its own default, then each it offers", async () => {
    const { runner, logged, cwd } = fakeOpenCode();
    expect([runner.id, runner.name]).toEqual(["opencode", "OpenCode"]);
    const models = await runner.models(new AbortController().signal);
    expect(models.ok && models.value).toEqual([
      { id: null, name: "OpenCode's default (anthropic/claude-sonnet)" },
      { id: "anthropic/claude-sonnet", name: "Claude Sonnet" },
      { id: "openai/gpt-5", name: "openai/gpt-5" },
    ]);
    // Asked in XueFu's own empty folder, the session deleted after.
    expect(logged()[0]).toMatchObject({ leaked: false, cwd });
    expect(logged().map((entry) => entry["method"])).toContain("session/delete");
  });

  test("models it cannot list, or is told to stop listing, say why", async () => {
    const broken = await fakeOpenCode({ OPENCODE_FAKE_BROKEN: "1" }).runner.models();
    expect(!broken.ok && broken.error.message).toBe(
      "OpenCode could not start a session: no provider",
    );
    const listing = new AbortController();
    const hanging = fakeOpenCode({ OPENCODE_FAKE_HANG: "1" }).runner.models(listing.signal);
    listing.abort();
    const cancelled = await hanging;
    expect(!cancelled.ok && cancelled.error.message).toBe(
      "Listing OpenCode's models was cancelled",
    );
    const missing = await openCode({
      command: "/nonexistent/opencode",
      env: {},
      scratch: "/tmp" as AbsolutePath,
    }).models();
    expect(!missing.ok && missing.error.hint).toContain("OpenCode is installed");
  });

  test("runs in plan mode with XueFu's tools, sends each message, and deletes its session", async () => {
    let turns = 0;
    const { exited, logged, cwd } = converse("hello", (event, session) => {
      if (event.kind !== "turn") return;
      turns += 1;
      if (turns === 1) session.send("again");
      else session.stop();
    });
    const events = await exited;
    expect(events).toEqual([
      { kind: "ready", model: "anthropic/claude-sonnet" },
      // What it thought, whole, before what it then says.
      { kind: "thinking", text: "Read the diff." },
      // The instructions come first, in a block of their own.
      { kind: "text", text: "you said hello in 2 blocks" },
      { kind: "tool", name: "pr_diff", input: { pullRequest: "MOB/app#42" } },
      { kind: "tool", name: "read", input: {} },
      { kind: "thinking", text: "Nothing more to say." },
      { kind: "turn", costUsd: 0.02, failed: null },
      { kind: "thinking", text: "Read the diff." },
      { kind: "text", text: "you said again in 1 blocks" },
      { kind: "tool", name: "pr_diff", input: { pullRequest: "MOB/app#42" } },
      { kind: "tool", name: "read", input: {} },
      { kind: "thinking", text: "Nothing more to say." },
      { kind: "turn", costUsd: 0.02, failed: null },
      { kind: "exit", message: null },
    ]);
    const log = logged();
    expect(log[0]).toMatchObject({ leaked: false, cwd });
    expect(JSON.parse(String(log[0]?.["config"]))).toMatchObject({
      permission: { edit: "deny" },
    });
    const methods = log.slice(1).map((entry) => entry["method"]);
    expect(methods).toEqual([
      "initialize",
      "session/new",
      "session/set_config_option",
      "session/prompt",
      "session/prompt",
      "session/cancel",
      "session/delete",
    ]);
    expect(log[2]?.["params"]).toMatchObject({
      cwd,
      mcpServers: [{ type: "http", name: "xuefu" }],
    });
    expect(log[3]?.["params"]).toMatchObject({ configId: "mode", value: "plan" });
    expect(log[4]?.["params"]).toMatchObject({
      prompt: [
        { type: "text", text: "You are inside XueFu." },
        { type: "text", text: "hello" },
      ],
    });
  });

  test("on the model chosen; one it does not have ends it, saying so", async () => {
    const chosen = converse(
      "hello",
      (event, session) => {
        if (event.kind === "turn") session.stop();
      },
      { model: "openai/gpt-5" },
    );
    expect((await chosen.exited)[0]).toEqual({ kind: "ready", model: "openai/gpt-5" });
    expect(chosen.logged()[4]?.["params"]).toMatchObject({
      configId: "model",
      value: "openai/gpt-5",
    });

    const unknown = converse("hello", ignore, { model: "nope/none" });
    expect(await unknown.exited).toEqual([
      { kind: "exit", message: "OpenCode cannot use nope/none: model not found: nope/none" },
    ]);
  });

  test("what it would do with its own tools is asked of the user, once", async () => {
    for (const allowed of [true, false]) {
      const { exited, asked } = converse(
        "permission",
        (event, session) => {
          if (event.kind === "turn") session.stop();
        },
        { answer: allowed },
      );
      const events = await exited;
      expect(asked.map((prompt) => prompt.title)).toEqual(["Let OpenCode use bash"]);
      expect(events).toContainEqual({
        kind: "text",
        text: `answered {"outcome":{"outcome":"selected","optionId":"${allowed ? "once" : "no"}"}}`,
      });
    }
  });

  test("an answer cut short says why", async () => {
    const { exited } = converse("long", (event, session) => {
      if (event.kind === "turn") session.stop();
    });
    expect(await exited).toContainEqual({
      kind: "turn",
      costUsd: null,
      failed: "It ran out of room for its answer.",
    });
  });

  test("one that stops on its own says why, from the last thing it wrote", async () => {
    const { exited } = converse("fail", ignore);
    expect((await exited).at(-1)).toEqual({ kind: "exit", message: "Invalid API key" });
  });

  test("one that cannot start a session says so; stopping twice does nothing more", async () => {
    const { exited, started } = converse("hello", ignore, { env: { OPENCODE_FAKE_BROKEN: "1" } });
    expect(await exited).toEqual([
      { kind: "exit", message: "OpenCode could not start a session: no provider" },
    ]);
    if (started.ok) {
      started.value.stop();
      started.value.stop();
    }
  });

  test("stopped before it answers, it ends without a word", async () => {
    const { exited, started } = converse("hello", ignore, { env: { OPENCODE_FAKE_HANG: "1" } });
    if (started.ok) started.value.stop();
    expect(await exited).toEqual([{ kind: "exit", message: null }]);
  });

  test("a program that is not there cannot start", () => {
    const started = openCode({
      command: "/nonexistent/opencode",
      env: {},
      scratch: "/tmp" as AbsolutePath,
    }).start(LAUNCH, ignore, () => Promise.resolve(false));
    expect(!started.ok && started.error.message).toBe("Unable to run /nonexistent/opencode");
  });
});
