import type { StorageError } from "../../domain/shared/errors";
import type { Result } from "../../domain/shared/result";
import type { Timestamp } from "../../domain/shared/time";
import type { Timer } from "../../domain/timesheet/timer";
import type { TrackedSpan } from "../../domain/timesheet/tracked";

/** Timers and their segments. Stopped timers are kept: they are the record of tracked time. */
export interface TimerRepository {
  /** The running or paused timer; storage guarantees there is at most one. */
  active(): Result<Timer | null, StorageError>;
  /** Inserts or replaces the timer with all of its segments. */
  save(timer: Timer): Result<void, StorageError>;
  /** Every segment, of any timer, still open or ended after `since`; oldest first. */
  trackedSince(since: Timestamp): Result<TrackedSpan[], StorageError>;
}
