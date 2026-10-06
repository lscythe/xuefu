import { appendFileSync, mkdirSync, renameSync, statSync } from "node:fs";
import { dirname } from "node:path";
import { type FileSystemError, fileSystemError } from "../../domain/shared/errors";
import { err, fromThrowable, map, type Result } from "../../domain/shared/result";
import type { LogRecord, LogSink } from "./logger";

function isMissingFile(thrown: unknown): boolean {
  return (
    typeof thrown === "object" && thrown !== null && "code" in thrown && thrown.code === "ENOENT"
  );
}

// Use-then-handle instead of check-then-use: the TUI and a CLI invocation can share the log file,
// so a file seen by existsSync may be renamed by the other process before it is used.
function sizeOrZero(path: string): number {
  try {
    return statSync(path).size;
  } catch (thrown) {
    if (isMissingFile(thrown)) return 0;
    throw thrown;
  }
}

function renameIfPresent(from: string, to: string): void {
  try {
    renameSync(from, to);
  } catch (thrown) {
    // Already rotated away (by us earlier or by another process): nothing to move.
    if (!isMissingFile(thrown)) throw thrown;
  }
}

export interface FileSinkOptions {
  readonly path: string;
  /** Rotate before a write would push the active file past this size. */
  readonly maxBytes: number;
  /** Number of rotated files kept (`xuefu.log.1` … `xuefu.log.N`). */
  readonly maxFiles: number;
}

/** Append-only JSON-lines log with size-based rotation. Files are created 0600 in a 0700 dir. */
export class JsonLinesFileSink implements LogSink {
  readonly name = "file";

  private constructor(
    private readonly options: FileSinkOptions,
    private size: number,
  ) {}

  static open(options: FileSinkOptions): Result<JsonLinesFileSink, FileSystemError> {
    if (!Number.isSafeInteger(options.maxBytes) || options.maxBytes < 1) {
      return err(fileSystemError("maxBytes must be a positive integer", options.path, "open"));
    }
    if (!Number.isSafeInteger(options.maxFiles) || options.maxFiles < 1) {
      return err(fileSystemError("maxFiles must be a positive integer", options.path, "open"));
    }
    const prepared = fromThrowable(
      () => {
        mkdirSync(dirname(options.path), { recursive: true, mode: 0o700 });
        return sizeOrZero(options.path);
      },
      (thrown) =>
        fileSystemError("Unable to prepare log file", options.path, "open", { cause: thrown }),
    );
    return map(prepared, (size) => new JsonLinesFileSink(options, size));
  }

  write(record: LogRecord): void {
    const line = `${JSON.stringify(record)}\n`;
    const bytes = Buffer.byteLength(line);
    if (this.size > 0 && this.size + bytes > this.options.maxBytes) this.rotate();
    appendFileSync(this.options.path, line, { mode: 0o600 });
    this.size += bytes;
  }

  private rotate(): void {
    const { path, maxFiles } = this.options;
    for (let i = maxFiles - 1; i >= 1; i -= 1) {
      renameIfPresent(`${path}.${i}`, `${path}.${i + 1}`);
    }
    renameIfPresent(path, `${path}.1`);
    this.size = 0;
  }
}
