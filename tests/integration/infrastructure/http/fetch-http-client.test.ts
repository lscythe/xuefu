import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { FetchHttpClient, retryDelay } from "../../../../src/infrastructure/http/fetch-http-client";
import { testLogger } from "../../../support/test-logger";

/** What the local server saw, and how many times each path was asked for. */
const seen: { method: string; path: string; headers: Headers; body: string }[] = [];
const hits = new Map<string, number>();
let server: ReturnType<typeof Bun.serve>;

beforeAll(() => {
  server = Bun.serve({
    port: 0,
    async fetch(request) {
      const url = new URL(request.url);
      seen.push({
        method: request.method,
        path: url.pathname + url.search,
        headers: request.headers,
        body: await request.text(),
      });
      const count = (hits.get(url.pathname) ?? 0) + 1;
      hits.set(url.pathname, count);
      switch (url.pathname) {
        case "/json":
          return Response.json({ ok: true }, { headers: { "X-Thing": "yes" } });
        case "/missing":
          return new Response("nope", { status: 404 });
        case "/busy":
          return count < 3
            ? new Response("slow down", { status: 429, headers: { "Retry-After": "1" } })
            : Response.json({ third: true });
        case "/always-busy":
          return new Response("down", { status: 503 });
        case "/slow":
          await Bun.sleep(500);
          return new Response("late");
        case "/big":
          return new Response("x".repeat(2048));
        default:
          return new Response("?", { status: 400 });
      }
    },
  });
});
afterAll(() => {
  server.stop(true);
});

const url = (path: string) => `http://127.0.0.1:${server.port}${path}`;
const waits: number[] = [];
const client = new FetchHttpClient(testLogger().logger, {
  sleep: (ms) => {
    waits.push(ms);
    return Promise.resolve();
  },
});

describe("FetchHttpClient", () => {
  test("sends JSON with the headers given, and reads status, headers and body", async () => {
    const answered = await client.request(
      { method: "POST", url: url("/json"), headers: { Authorization: "Bearer t" }, body: { a: 1 } },
      { timeoutMs: 5000 },
    );
    expect(answered.ok && answered.value).toMatchObject({
      status: 200,
      body: '{"ok":true}',
      headers: { "x-thing": "yes" },
    });
    const sent = seen.at(-1);
    expect(sent?.body).toBe('{"a":1}');
    expect(sent?.headers.get("authorization")).toBe("Bearer t");
    expect(sent?.headers.get("content-type")).toBe("application/json");
    expect(sent?.headers.get("accept")).toBe("application/json");
  });

  test("a failing status is an answer, not an error", async () => {
    const answered = await client.request(
      { method: "GET", url: url("/missing") },
      { timeoutMs: 5000 },
    );
    expect(answered.ok && answered.value.status).toBe(404);
  });

  test("a GET to a rate-limiting server is tried again as Retry-After asks", async () => {
    waits.length = 0;
    const answered = await client.request(
      { method: "GET", url: url("/busy") },
      { timeoutMs: 5000 },
    );
    expect(answered.ok && answered.value.body).toBe('{"third":true}');
    expect(waits).toEqual([1000, 1000]);
  });

  test("it gives up after two retries, and never retries what changes things", async () => {
    hits.delete("/always-busy");
    const got = await client.request(
      { method: "GET", url: url("/always-busy") },
      { timeoutMs: 5000 },
    );
    expect(got.ok && got.value.status).toBe(503);
    expect(hits.get("/always-busy")).toBe(3);
    hits.delete("/always-busy");
    await client.request({ method: "POST", url: url("/always-busy") }, { timeoutMs: 5000 });
    expect(hits.get("/always-busy")).toBe(1);
  });

  test("too slow is a timeout; cancelled is cancelled", async () => {
    const slow = await client.request({ method: "GET", url: url("/slow") }, { timeoutMs: 50 });
    expect(slow.ok ? null : slow.error).toMatchObject({ kind: "timeout", afterMs: 50 });
    const controller = new AbortController();
    const pending = client.request(
      { method: "GET", url: url("/slow") },
      { timeoutMs: 5000, signal: controller.signal },
    );
    controller.abort();
    const stopped = await pending;
    expect(stopped.ok ? null : stopped.error.kind).toBe("cancelled");
  });

  test("an answer longer than the limit is refused", async () => {
    const big = await client.request(
      { method: "GET", url: url("/big") },
      { timeoutMs: 5000, maxBodyBytes: 1024 },
    );
    expect(big.ok ? null : big.error).toMatchObject({ kind: "remote", status: 200 });
  });

  test("a server that is not there names only its host, with a hint", async () => {
    const closed = Bun.serve({ port: 0, fetch: () => new Response() });
    const port = closed.port;
    closed.stop(true);
    const gone = await client.request(
      { method: "GET", url: `http://127.0.0.1:${port}/x?token=secret` },
      { timeoutMs: 5000 },
    );
    expect(gone.ok ? null : gone.error).toMatchObject({
      kind: "remote",
      service: `127.0.0.1:${port}`,
      status: null,
      message: `Could not reach 127.0.0.1:${port}`,
    });
    expect(JSON.stringify(gone)).not.toContain("secret");
  });
});

describe("retryDelay", () => {
  test("seconds or an HTTP date, capped at ten seconds; backing off without one", () => {
    expect(retryDelay("3", 0)).toBe(3000);
    expect(retryDelay("120", 0)).toBe(10_000);
    expect(retryDelay(new Date(5000).toUTCString(), 0, 2000)).toBe(3000);
    expect(retryDelay(undefined, 0)).toBe(500);
    expect(retryDelay(undefined, 1)).toBe(1000);
    expect(retryDelay("soon", 1)).toBe(1000);
  });
});
