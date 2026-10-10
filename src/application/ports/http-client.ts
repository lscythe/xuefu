import type { CancelledError, RemoteError, TimeoutError } from "../../domain/shared/errors";
import type { Result } from "../../domain/shared/result";

export interface HttpRequest {
  readonly method: "GET" | "POST" | "PUT" | "DELETE";
  readonly url: string;
  readonly headers?: Readonly<Record<string, string>>;
  /** Sent as JSON. */
  readonly body?: unknown;
}

export interface HttpOptions {
  /** For each attempt; a slow answer is stopped once this long has passed. */
  readonly timeoutMs: number;
  readonly signal?: AbortSignal;
  /** Bytes of body kept; a longer answer is a failure. Defaults to 4 MiB. */
  readonly maxBodyBytes?: number;
}

/** What the server answered. A failing status is an outcome, not an error: callers decide. */
export interface HttpResponse {
  readonly status: number;
  /** Header names in lower case. */
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
}

export type HttpFailure = RemoteError | TimeoutError | CancelledError;

/**
 * Talks HTTP to the services plugins integrate with. Fails only when there is no answer: the
 * server cannot be reached, takes too long, the call is cancelled, or the answer is too long.
 */
export interface HttpClient {
  request(request: HttpRequest, options: HttpOptions): Promise<Result<HttpResponse, HttpFailure>>;
}
