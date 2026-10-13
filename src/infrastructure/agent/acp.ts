import { lines } from "./lines";

/** What a request came back with: its result, or why it failed. */
type Reply =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly message: string };

/** What the agent asks or tells its client, the other way. */
export interface AcpClient {
  /** Answers a request of the agent's; null for one this client does not take. */
  readonly request: (method: string, params: unknown) => Promise<object | null>;
  readonly notify: (method: string, params: unknown) => void;
}

/** A conversation in JSON-RPC 2.0, a message a line, over an agent's stdin and stdout. */
export interface AcpConnection {
  call(method: string, params: object): Promise<Reply>;
  notify(method: string, params: object): void;
}

export const record = (value: unknown): Readonly<Record<string, unknown>> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

/**
 * Speaks the Agent Client Protocol with an agent run as `child`. Its requests are answered by
 * `client`; once its output ends, every call still waiting fails, saying it stopped.
 */
export function acpConnection(
  child: { readonly stdin: Bun.FileSink; readonly stdout: ReadableStream<Uint8Array> },
  client: AcpClient,
): AcpConnection {
  let next = 0;
  let closed = false;
  const waiting = new Map<number, (reply: Reply) => void>();
  const write = (message: object) => {
    try {
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", ...message })}\n`);
      child.stdin.flush();
    } catch {
      // It has gone; what waits on it is told so when its output ends.
    }
  };
  const answer = async (id: unknown, method: string, params: unknown) => {
    try {
      const result = await client.request(method, params);
      write(
        result === null
          ? { id, error: { code: -32601, message: `${method} is not supported` } }
          : { id, result },
      );
    } catch (thrown) {
      write({ id, error: { code: -32603, message: String(thrown) } });
    }
  };

  void (async () => {
    for await (const line of lines(child.stdout)) {
      let message: Readonly<Record<string, unknown>> | null = null;
      try {
        message = record(JSON.parse(line));
      } catch {
        continue;
      }
      if (message === null) continue;
      const { id, method, params } = message;
      if (typeof method === "string") {
        if (id === undefined) client.notify(method, params);
        else void answer(id, method, params);
        continue;
      }
      const resolve = typeof id === "number" ? waiting.get(id) : undefined;
      if (resolve === undefined) continue;
      waiting.delete(id as number);
      const error = record(message["error"]);
      resolve(
        error === null
          ? { ok: true, value: message["result"] ?? null }
          : { ok: false, message: String(error["message"] ?? "it failed") },
      );
    }
    closed = true;
    for (const resolve of waiting.values()) resolve({ ok: false, message: "it stopped" });
    waiting.clear();
  })();

  return {
    call(method, params) {
      if (closed) return Promise.resolve({ ok: false, message: "it stopped" });
      next += 1;
      const id = next;
      return new Promise((resolve) => {
        waiting.set(id, resolve);
        write({ id, method, params });
      });
    },
    notify(method, params) {
      write({ method, params });
    },
  };
}
