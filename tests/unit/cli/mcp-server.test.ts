import { describe, expect, test } from "bun:test";
import { type CommandRun, type McpServer, serveMcp } from "../../../src/cli/mcp-server";
import type { McpTool } from "../../../src/cli/mcp-tools";

const ECHO: McpTool = {
  name: "echo",
  description: "Say it back",
  parameters: { text: { type: "string", description: "what to say", required: true } },
  changes: false,
  argv: (values) => ["echo", String(values["text"])],
};
const MERGE: McpTool = {
  name: "merge",
  description: "Merge it",
  parameters: {},
  changes: true,
  argv: () => ["merge"],
};

interface Served {
  readonly replies: Record<string, unknown>[];
  readonly ran: (readonly string[])[];
}

/** Sends the client's lines, as chunks, and returns what the server wrote back in order. */
async function serve(
  chunks: readonly string[],
  run: (argv: readonly string[]) => Promise<CommandRun> = (argv) =>
    Promise.resolve({ code: 0, stdout: `${argv.join(" ")}\n`, stderr: "" }),
): Promise<Served> {
  const written: string[] = [];
  const ran: (readonly string[])[] = [];
  const server: McpServer = {
    version: "9.9.9",
    tools: [ECHO, MERGE],
    run: (argv) => {
      ran.push(argv);
      return run(argv);
    },
    write: (text) => written.push(text),
  };
  await serveMcp(server, chunks);
  for (const text of written) expect(text.endsWith("\n")).toBe(true);
  return { replies: written.map((text) => JSON.parse(text)), ran };
}

const line = (message: object) => `${JSON.stringify({ jsonrpc: "2.0", ...message })}\n`;
const call = (id: number, name: string, args?: unknown) =>
  line({ id, method: "tools/call", params: { name, arguments: args } });

describe("serveMcp", () => {
  test("initialize agrees on a protocol version and says what XueFu offers", async () => {
    const { replies } = await serve([
      line({ id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } }),
      line({ method: "notifications/initialized" }),
      line({ id: "two", method: "initialize", params: { protocolVersion: "1999-01-01" } }),
    ]);
    expect(replies).toHaveLength(2);
    expect(replies[0]).toMatchObject({
      jsonrpc: "2.0",
      id: 1,
      result: {
        protocolVersion: "2025-06-18",
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "xuefu", title: "XueFu", version: "9.9.9" },
      },
    });
    expect(JSON.stringify(replies[0])).toContain("yes set to true only once they agree");
    // One it does not know gets the newest it does.
    expect(replies[1]).toMatchObject({ id: "two", result: { protocolVersion: "2025-11-25" } });
  });

  test("tools/list describes each tool, and whether it only reads", async () => {
    const { replies } = await serve([line({ id: 1, method: "tools/list" })]);
    expect(replies[0]).toEqual({
      jsonrpc: "2.0",
      id: 1,
      result: {
        tools: [
          {
            name: "echo",
            description: "Say it back",
            inputSchema: {
              type: "object",
              properties: { text: { type: "string", description: "what to say" } },
              required: ["text"],
              additionalProperties: false,
            },
            annotations: { readOnlyHint: true },
          },
          {
            name: "merge",
            description: "Merge it",
            inputSchema: {
              type: "object",
              properties: {},
              required: [],
              additionalProperties: false,
            },
            annotations: { readOnlyHint: false },
          },
        ],
      },
    });
  });

  test("tools/call runs the tool's command and answers with what it said", async () => {
    const { replies, ran } = await serve([call(1, "echo", { text: "hello" })]);
    expect(ran).toEqual([["echo", "hello"]]);
    expect(replies[0]).toEqual({
      jsonrpc: "2.0",
      id: 1,
      result: { content: [{ type: "text", text: "echo hello\n" }], isError: false },
    });
  });

  test("a command that found nothing has done its job; any other failure is an error", async () => {
    const runs: Record<string, CommandRun> = {
      none: { code: 1, stdout: "", stderr: "No work in progress.\n" },
      quiet: { code: 0, stdout: "", stderr: "" },
      both: { code: 0, stdout: "✓ Started\n", stderr: "MOB-1 is To Do in Jira\n" },
      refused: { code: 64, stdout: "", stderr: "? Merge\n" },
      silent: { code: 70, stdout: "", stderr: "" },
    };
    const { replies } = await serve(
      Object.keys(runs).map((text, index) => call(index, "echo", { text })),
      (argv) => Promise.resolve(runs[argv[1] ?? ""] as CommandRun),
    );
    const results = replies
      .toSorted((a, b) => Number(a["id"]) - Number(b["id"]))
      .map((reply) => reply["result"]);
    expect(results).toEqual([
      { content: [{ type: "text", text: "No work in progress.\n" }], isError: false },
      { content: [{ type: "text", text: "Done." }], isError: false },
      {
        content: [{ type: "text", text: "✓ Started\n\nMOB-1 is To Do in Jira\n" }],
        isError: false,
      },
      { content: [{ type: "text", text: "? Merge\n" }], isError: true },
      { content: [{ type: "text", text: "Failed with exit code 70" }], isError: true },
    ]);
  });

  test("bad arguments, and a command that throws, are told as the tool's answer", async () => {
    const { replies, ran } = await serve(
      [call(1, "echo", {}), call(2, "echo", { text: 3 }), call(3, "merge")],
      () => Promise.reject(new Error("database is locked")),
    );
    expect(ran).toEqual([["echo", "3"], ["merge"]]);
    const byId = Object.fromEntries(replies.map((reply) => [reply["id"], reply["result"]]));
    expect(byId).toEqual({
      1: { content: [{ type: "text", text: "Missing argument: text" }], isError: true },
      2: { content: [{ type: "text", text: "database is locked" }], isError: true },
      3: { content: [{ type: "text", text: "database is locked" }], isError: true },
    });
  });

  test("a thrown value that is not an error is said as it is", async () => {
    const { replies } = await serve([call(1, "merge")], () => Promise.reject("gone"));
    expect(replies[0]).toMatchObject({ result: { content: [{ text: "gone" }], isError: true } });
  });

  test("protocol errors: unknown tools and methods, bad JSON, and what is not a request", async () => {
    const { replies } = await serve([
      call(1, "rm"),
      line({ id: 2, method: "resources/list" }),
      "{not json\n",
      `${JSON.stringify({ id: 4, method: "ping" })}\n`,
      `${JSON.stringify([{ jsonrpc: "2.0", id: 5, method: "ping" }])}\n`,
      line({ id: { nested: true }, method: "ping" }),
      line({ id: 7, method: "tools/call" }),
      "null\n",
    ]);
    expect(replies).toEqual([
      { jsonrpc: "2.0", id: 1, error: { code: -32602, message: "Unknown tool: rm" } },
      {
        jsonrpc: "2.0",
        id: 2,
        error: { code: -32601, message: "Method not found: resources/list" },
      },
      { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } },
      { jsonrpc: "2.0", id: 4, error: { code: -32600, message: "Invalid request" } },
      { jsonrpc: "2.0", id: null, error: { code: -32600, message: "Invalid request" } },
      { jsonrpc: "2.0", id: null, error: { code: -32600, message: "Invalid request" } },
      { jsonrpc: "2.0", id: 7, error: { code: -32602, message: "Unknown tool: undefined" } },
      { jsonrpc: "2.0", id: null, error: { code: -32600, message: "Invalid request" } },
    ]);
  });

  test("ping answers; notifications and the client's own answers get no reply", async () => {
    const { replies } = await serve([
      line({ method: "notifications/cancelled", params: { requestId: 1 } }),
      line({ id: 9, result: {} }),
      line({ id: 10, error: { code: 1, message: "no" } }),
      line({ id: 11, method: "ping" }),
    ]);
    expect(replies).toEqual([{ jsonrpc: "2.0", id: 11, result: {} }]);
  });

  test("messages split across chunks, blank lines and a last line without a newline", async () => {
    const whole = call(1, "echo", { text: "split" });
    const { replies } = await serve([
      whole.slice(0, 10),
      whole.slice(10, 30),
      `${whole.slice(30)}\r\n\n`,
      JSON.stringify({ jsonrpc: "2.0", id: 2, method: "ping" }),
    ]);
    expect(replies.map((reply) => reply["id"])).toEqual([1, 2]);
  });

  test("a slow call holds up no other; each is answered as it finishes", async () => {
    const { promise: slow, resolve } = Promise.withResolvers<CommandRun>();
    const order: unknown[] = [];
    await serveMcp(
      {
        version: "9.9.9",
        tools: [ECHO],
        run: (argv) =>
          argv[1] === "slow" ? slow : Promise.resolve({ code: 0, stdout: "fast", stderr: "" }),
        write: (text) => {
          order.push(JSON.parse(text).id);
          if (order.length === 1) resolve({ code: 0, stdout: "slow", stderr: "" });
        },
      },
      [call(1, "echo", { text: "slow" }), call(2, "echo", { text: "fast" })],
    );
    expect(order).toEqual([2, 1]);
  });
});
