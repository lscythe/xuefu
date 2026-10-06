export type LogLevel = "trace" | "debug" | "info" | "warn" | "error";

export const LOG_LEVELS: readonly LogLevel[] = ["trace", "debug", "info", "warn", "error"];

export type LogFields = Readonly<Record<string, unknown>>;

export interface Logger {
  trace(message: string, fields?: LogFields): void;
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
  /** Returns a logger whose records always include `bindings` (workspace, correlationId, …). */
  child(bindings: LogFields): Logger;
}

export function isLevelEnabled(minimum: LogLevel, level: LogLevel): boolean {
  return LOG_LEVELS.indexOf(level) >= LOG_LEVELS.indexOf(minimum);
}
