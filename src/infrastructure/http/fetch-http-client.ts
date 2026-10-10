import type {
  HttpClient,
  HttpFailure,
  HttpOptions,
  HttpRequest,
  HttpResponse,
} from "../../application/ports/http-client";
import type { Logger } from "../../application/ports/logger";
import { cancelled, remoteError, timeout } from "../../domain/shared/errors";
import { err, ok, type Result } from "../../domain/shared/result";

const DEFAULT_MAX_BODY = 4 * 1024 * 1024;
/** Answers worth asking again for, after a pause: too many requests, or the server is busy. */
const RETRY_STATUSES = new Set([429, 502, 503, 504]);
const MAX_RETRIES = 2;
const BASE_DELAY_MS = 500;
/** Never wait longer than this between attempts, whatever Retry-After asks. */
const MAX_DELAY_MS = 10_000;

export interface FetchHttpOptions {
  /** Waits between attempts; tests pass one that does not. */
  readonly sleep?: (ms: number, signal: AbortSignal | undefined) => Promise<void>;
}

const abortableSleep = (ms: number, signal: AbortSignal | undefined) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });

const isAborted = (signal: AbortSignal | undefined) => signal?.aborted === true;

/** How long Retry-After asks to wait: seconds, or an HTTP date. */
export function retryDelay(header: string | undefined, attempt: number, now = Date.now()): number {
  const fallback = BASE_DELAY_MS * 2 ** attempt;
  if (header === undefined) return fallback;
  const seconds = Number(header);
  const ms = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(header) - now;
  return Number.isFinite(ms) ? Math.min(MAX_DELAY_MS, Math.max(0, ms)) : fallback;
}

/** Reads at most `max` bytes of the body; null when it is longer. */
async function boundedText(response: Response, max: number): Promise<string | null> {
  const reader = response.body?.getReader();
  if (reader === undefined) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

/**
 * HTTP over fetch. GETs that meet a busy or rate-limiting server are tried again, up to twice,
 * waiting as Retry-After asks. Only the method, host, path and status are logged: query strings
 * and headers may carry tokens.
 */
export class FetchHttpClient implements HttpClient {
  readonly #sleep: (ms: number, signal: AbortSignal | undefined) => Promise<void>;

  constructor(
    private readonly logger: Logger,
    options: FetchHttpOptions = {},
  ) {
    this.#sleep = options.sleep ?? abortableSleep;
  }

  async request(
    request: HttpRequest,
    options: HttpOptions,
  ): Promise<Result<HttpResponse, HttpFailure>> {
    const retries = request.method === "GET" ? MAX_RETRIES : 0;
    for (let attempt = 0; ; attempt++) {
      const answered = await this.once(request, options);
      if (!answered.ok) return answered;
      const response = answered.value;
      if (attempt >= retries || !RETRY_STATUSES.has(response.status)) return answered;
      const wait = retryDelay(response.headers["retry-after"], attempt);
      this.logger.debug("HTTP retry", { status: response.status, waitMs: wait, attempt });
      await this.#sleep(wait, options.signal);
      if (options.signal?.aborted === true) return err(cancelled("The request was cancelled"));
    }
  }

  private async once(
    request: HttpRequest,
    options: HttpOptions,
  ): Promise<Result<HttpResponse, HttpFailure>> {
    let url: URL;
    try {
      url = new URL(request.url);
    } catch {
      return err(remoteError("Not a URL XueFu can request", "unknown", null));
    }
    const service = url.host;
    if (options.signal?.aborted === true)
      return err(cancelled(`The request to ${service} was cancelled`));
    const timer = AbortSignal.timeout(options.timeoutMs);
    const signal = options.signal === undefined ? timer : AbortSignal.any([options.signal, timer]);
    const started = performance.now();
    try {
      const response = await fetch(url, {
        method: request.method,
        headers: {
          accept: "application/json",
          ...(request.body === undefined ? {} : { "content-type": "application/json" }),
          ...request.headers,
        },
        ...(request.body === undefined ? {} : { body: JSON.stringify(request.body) }),
        signal,
        redirect: "follow",
      });
      const body = await boundedText(response, options.maxBodyBytes ?? DEFAULT_MAX_BODY);
      this.logger.debug("HTTP request", {
        method: request.method,
        host: service,
        path: url.pathname,
        status: response.status,
        durationMs: Math.round(performance.now() - started),
      });
      if (body === null) {
        return err(
          remoteError(`${service} answered with more than XueFu reads`, service, response.status),
        );
      }
      const headers: Record<string, string> = {};
      response.headers.forEach((value, name) => {
        headers[name.toLowerCase()] = value;
      });
      return ok({ status: response.status, headers, body });
    } catch (thrown) {
      // Read again: TypeScript still holds the value from before the await.
      if (isAborted(options.signal)) {
        return err(cancelled(`The request to ${service} was cancelled`));
      }
      if (timer.aborted) {
        return err(timeout(`${service} did not answer in time`, options.timeoutMs));
      }
      const reason = thrown instanceof Error ? thrown.message : String(thrown);
      return err(
        remoteError(`Could not reach ${service}`, service, null, {
          hint: `Check the address and your network or VPN (${reason}).`,
        }),
      );
    }
  }
}
