import type {
  ProcessFailure,
  ProcessOptions,
  ProcessOutput,
  ProcessRunner,
  ProcessSpec,
} from "../../application/ports/process-runner";
import { cancelled, processError, timeout } from "../../domain/shared/errors";
import { err, ok, type Result } from "../../domain/shared/result";

const DEFAULT_MAX_OUTPUT = 1024 * 1024;
/** Enough stderr for a message; older lines are dropped first. */
const MAX_STDERR = 64 * 1024;
/** How long a stopped program gets between SIGTERM and SIGKILL. */
const DEFAULT_GRACE_MS = 2000;

/**
 * What a child may see of XueFu's environment: enough for tools to find their config, locale and
 * credential agents, nothing else. Variables named `LC_*` and `GIT_*` pass too.
 */
const ALLOWED_ENV = new Set([
  "PATH",
  "HOME",
  "USER",
  "LOGNAME",
  "SHELL",
  "LANG",
  "TERM",
  "TMPDIR",
  "TZ",
  "SSH_AUTH_SOCK",
  "XDG_CONFIG_HOME",
  "XDG_DATA_HOME",
  "XDG_CACHE_HOME",
]);
const ALLOWED_ENV_PREFIXES = ["LC_", "GIT_"];

export function childEnvironment(
  parent: Readonly<Record<string, string | undefined>>,
  extra: Readonly<Record<string, string>> = {},
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [name, value] of Object.entries(parent)) {
    if (value === undefined) continue;
    if (ALLOWED_ENV.has(name) || ALLOWED_ENV_PREFIXES.some((prefix) => name.startsWith(prefix))) {
      env[name] = value;
    }
  }
  return { ...env, ...extra };
}

interface Captured {
  readonly bytes: Uint8Array;
  readonly truncated: boolean;
}

/** Reads a stream to its end, keeping at most `max` bytes from its start or its end. */
async function capture(
  stream: ReadableStream<Uint8Array>,
  max: number,
  keep: "head" | "tail",
): Promise<Captured> {
  const chunks: Uint8Array[] = [];
  let size = 0;
  let truncated = false;
  for await (const chunk of stream) {
    if (keep === "head") {
      const room = max - size;
      if (room <= 0) {
        truncated = true;
        continue;
      }
      const part = chunk.byteLength > room ? chunk.subarray(0, room) : chunk;
      if (part !== chunk) truncated = true;
      chunks.push(part);
      size += part.byteLength;
      continue;
    }
    chunks.push(chunk);
    size += chunk.byteLength;
    while (size > max && chunks.length > 0) {
      const first = chunks[0] as Uint8Array;
      const excess = size - max;
      truncated = true;
      if (first.byteLength <= excess) {
        chunks.shift();
        size -= first.byteLength;
      } else {
        chunks[0] = first.subarray(excess);
        size -= excess;
      }
    }
  }
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, at);
    at += chunk.byteLength;
  }
  return { bytes, truncated };
}

/**
 * Runs programs with Bun.spawn: argv only, a minimal environment, bounded output, and a stop on
 * timeout or abort. Children still running when XueFu closes are stopped by `terminateAll`.
 */
export class BunProcessRunner implements ProcessRunner {
  private readonly live = new Set<Bun.Subprocess>();

  constructor(
    private readonly env: Readonly<Record<string, string | undefined>>,
    private readonly graceMs = DEFAULT_GRACE_MS,
  ) {}

  async run(
    spec: ProcessSpec,
    options: ProcessOptions,
  ): Promise<Result<ProcessOutput, ProcessFailure>> {
    if (options.signal?.aborted === true) {
      return err(cancelled(`${spec.command} was cancelled before it started`));
    }
    const started = performance.now();
    let child: Bun.Subprocess<"ignore", "pipe", "pipe">;
    try {
      child = Bun.spawn([spec.command, ...spec.args], {
        cwd: spec.cwd,
        env: childEnvironment(this.env, spec.env),
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
      });
    } catch (thrown) {
      return err(
        processError(`Unable to run ${spec.command}`, spec.command, null, {
          cause: thrown,
          hint: `Check that ${spec.command} is installed and on your PATH.`,
        }),
      );
    }
    this.live.add(child);

    let stoppedBy: "timeout" | "cancelled" | null = null;
    let forceKill: ReturnType<typeof setTimeout> | undefined;
    const stop = (reason: "timeout" | "cancelled") => {
      if (stoppedBy !== null) return;
      stoppedBy = reason;
      child.kill("SIGTERM");
      forceKill = setTimeout(() => child.kill("SIGKILL"), this.graceMs);
    };
    const timer = setTimeout(() => stop("timeout"), options.timeoutMs);
    const onAbort = () => stop("cancelled");
    options.signal?.addEventListener("abort", onAbort, { once: true });

    const [stdout, stderr, exitCode] = await Promise.all([
      capture(child.stdout, options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT, "head"),
      capture(child.stderr, MAX_STDERR, "tail"),
      child.exited,
    ]);
    clearTimeout(timer);
    clearTimeout(forceKill);
    options.signal?.removeEventListener("abort", onAbort);
    this.live.delete(child);

    if (stoppedBy === "timeout") {
      return err(timeout(`${spec.command} took too long`, options.timeoutMs));
    }
    if (stoppedBy === "cancelled") return err(cancelled(`${spec.command} was cancelled`));
    const decoder = new TextDecoder();
    return ok({
      exitCode,
      stdout: decoder.decode(stdout.bytes),
      stderr: decoder.decode(stderr.bytes),
      durationMs: Math.round(performance.now() - started),
      truncated: stdout.truncated,
    });
  }

  /** Stops every child still running; for shutdown. */
  terminateAll(): void {
    for (const child of this.live) child.kill("SIGTERM");
    this.live.clear();
  }
}
