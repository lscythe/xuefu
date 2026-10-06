import type { ValidationError } from "../../domain/shared/errors";
import { map, type Result } from "../../domain/shared/result";
import { RingBuffer } from "../../domain/shared/ring-buffer";
import type { LogRecord, LogSink } from "./logger";

/** Bounded in-memory sink backing the debug overlay and tests. */
export class MemorySink implements LogSink {
  readonly name = "memory";

  private constructor(private readonly buffer: RingBuffer<LogRecord>) {}

  static create(capacity: number): Result<MemorySink, ValidationError> {
    return map(RingBuffer.create<LogRecord>(capacity), (buffer) => new MemorySink(buffer));
  }

  write(record: LogRecord): void {
    this.buffer.push(record);
  }

  records(): LogRecord[] {
    return this.buffer.toArray();
  }
}
