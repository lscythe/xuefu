import type { StorageError } from "../../domain/shared/errors";
import type { TimerId } from "../../domain/shared/ids";
import type { Result } from "../../domain/shared/result";
import type { Timestamp } from "../../domain/shared/time";
import type { Timer } from "../../domain/timesheet/timer";
import type { TrackedSpan } from "../../domain/timesheet/tracked";

/** Timers and their segments. Stopped timers are kept: they are the record of tracked time. */
export interface TimerRepository {
  /** The running or paused timer; storage guarantees there is at most one. */
  active(): Result<Timer | null, StorageError>;
  timer(id: TimerId): Result<Timer | null, StorageError>;
  /** Inserts or replaces the timer with all of its segments. */
  save(timer: Timer): Result<void, StorageError>;
  /** Every segment, of any timer, that overlaps `from` until `to` or is still open; oldest first. */
  tracked(from: Timestamp, to: Timestamp): Result<TrackedSpan[], StorageError>;
}
