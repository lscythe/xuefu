import type { Clock } from "../../application/ports/clock";
import {
  isLevelEnabled,
  type LogFields,
  type Logger,
  type LogLevel,
} from "../../application/ports/logger";
import type { Redactor } from "../../application/security/redaction";

export interface LogRecord {
  readonly time: string;
  readonly level: LogLevel;
  readonly msg: string;
  readonly [field: string]: unknown;
}

export interface LogSink {
  readonly name: string;
  write(record: LogRecord): void;
}

export interface LoggerOptions {
  readonly level: LogLevel;
  readonly sinks: readonly LogSink[];
  readonly clock: Clock;
  readonly redactor: Redactor;
  /**
   * Called when a sink throws (disk full, permissions). Logging must never crash the app, and the
   * failure must still surface somewhere; bootstrap routes this to stderr.
   */
  readonly onSinkError: (error: unknown, sinkName: string) => void;
  readonly bindings?: LogFields;
}

const RESERVED_KEYS = new Set(["time", "level", "msg"]);

function protectReserved(fields: LogFields): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    out[RESERVED_KEYS.has(key) ? `_${key}` : key] = value;
  }
  return out;
}

export function createLogger(options: LoggerOptions): Logger {
  const bindings = options.bindings ?? {};

  const log = (level: LogLevel, message: string, fields: LogFields = {}): void => {
    if (!isLevelEnabled(options.level, level)) return;
    const extra = options.redactor.redactValue(protectReserved({ ...bindings, ...fields }));
    const record: LogRecord = {
      time: new Date(options.clock.now()).toISOString(),
      level,
      msg: options.redactor.redactString(message),
      ...(extra as Record<string, unknown>),
    };
    for (const sink of options.sinks) {
      try {
        sink.write(record);
      } catch (error) {
        options.onSinkError(error, sink.name);
      }
    }
  };

  return {
    trace: (message, fields) => log("trace", message, fields),
    debug: (message, fields) => log("debug", message, fields),
    info: (message, fields) => log("info", message, fields),
    warn: (message, fields) => log("warn", message, fields),
    error: (message, fields) => log("error", message, fields),
    child: (childBindings) =>
      createLogger({ ...options, bindings: { ...bindings, ...childBindings } }),
  };
}
