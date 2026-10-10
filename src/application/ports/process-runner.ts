import type { CancelledError, ProcessError, TimeoutError } from "../../domain/shared/errors";
import type { AbsolutePath } from "../../domain/shared/path";
import type { Result } from "../../domain/shared/result";

/** A program to run: an argv array, never a shell line. */
export interface ProcessSpec {
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: AbsolutePath;
  /** Added to the small allow-listed environment every child gets. */
  readonly env?: Readonly<Record<string, string>>;
}

export interface ProcessOptions {
  /** Stops the program: SIGTERM, then SIGKILL if it lingers. */
  readonly signal?: AbortSignal;
  /** Stopped the same way once this long has passed. */
  readonly timeoutMs: number;
  /** Bytes of stdout kept; the rest is dropped and `truncated` set. Defaults to 1 MiB. */
  readonly maxOutputBytes?: number;
}

/** How the program ended. A non-zero exit is an outcome, not an error: callers decide. */
export interface ProcessOutput {
  readonly exitCode: number;
  readonly stdout: string;
  /** The last part of stderr, for messages. */
  readonly stderr: string;
  readonly durationMs: number;
  /** Stdout went past `maxOutputBytes`. */
  readonly truncated: boolean;
}

export type ProcessFailure = ProcessError | TimeoutError | CancelledError;

/** Runs external programs; fails only when one cannot start, times out or is cancelled. */
export interface ProcessRunner {
  run(spec: ProcessSpec, options: ProcessOptions): Promise<Result<ProcessOutput, ProcessFailure>>;
}
