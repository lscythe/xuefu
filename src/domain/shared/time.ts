import type { Brand } from "./brand";
import { type ValidationError, validationError } from "./errors";
import { err, ok, type Result } from "./result";

/** Epoch milliseconds. */
export type Timestamp = Brand<number, "Timestamp">;

/** Elapsed milliseconds; never negative. */
export type Duration = Brand<number, "Duration">;

function isNonNegativeSafeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

export function timestamp(epochMs: number): Result<Timestamp, ValidationError> {
  if (!isNonNegativeSafeInteger(epochMs)) {
    return err(
      validationError("Timestamp must be a non-negative integer of epoch milliseconds", [
        { path: "timestamp", message: `received ${String(epochMs)}` },
      ]),
    );
  }
  return ok(epochMs as Timestamp);
}

export function duration(ms: number): Result<Duration, ValidationError> {
  if (!isNonNegativeSafeInteger(ms)) {
    return err(
      validationError("Duration must be a non-negative integer of milliseconds", [
        { path: "duration", message: `received ${String(ms)}` },
      ]),
    );
  }
  return ok(ms as Duration);
}

export function durationBetween(
  start: Timestamp,
  end: Timestamp,
): Result<Duration, ValidationError> {
  if (end < start) {
    return err(
      validationError("End time precedes start time", [{ path: "end", message: "before start" }], {
        start,
        end,
      }),
    );
  }
  return ok((end - start) as Duration);
}

export function addDuration(at: Timestamp, elapsed: Duration): Timestamp {
  return (at + elapsed) as Timestamp;
}

export function sumDurations(durations: readonly Duration[]): Duration {
  return durations.reduce((total, d) => total + d, 0) as Duration;
}

const pad = (value: number): string => String(value).padStart(2, "0");

/** "01:42:18": whole hours, minutes and seconds; hours widen past 99 instead of wrapping. */
export function clockDuration(elapsed: Duration): string {
  const seconds = Math.floor(elapsed / 1000);
  return `${pad(Math.floor(seconds / 3600))}:${pad(Math.floor(seconds / 60) % 60)}:${pad(seconds % 60)}`;
}

/** "1h 42m" or "35m": whole minutes, for totals read at a glance. */
export function shortDuration(elapsed: Duration): string {
  const minutes = Math.floor(elapsed / 60_000);
  const hours = Math.floor(minutes / 60);
  return hours === 0 ? `${minutes}m` : `${hours}h ${pad(minutes % 60)}m`;
}
