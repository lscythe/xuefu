import type { StorageError } from "../../domain/shared/errors";
import type { Result } from "../../domain/shared/result";
import type { Timer } from "../../domain/timesheet/timer";

/** Timers and their segments. Stopped timers are kept: they are the record of tracked time. */
export interface TimerRepository {
  /** The running or paused timer; storage guarantees there is at most one. */
  active(): Result<Timer | null, StorageError>;
  /** Inserts or replaces the timer with all of its segments. */
  save(timer: Timer): Result<void, StorageError>;
}
