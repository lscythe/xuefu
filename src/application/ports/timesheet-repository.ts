import type { CalendarDay } from "../../domain/shared/calendar";
import type { StorageError } from "../../domain/shared/errors";
import type { EntryId } from "../../domain/shared/ids";
import type { Result } from "../../domain/shared/result";
import type { Timestamp } from "../../domain/shared/time";
import type { TimesheetDay } from "../../domain/timesheet/day";
import type { TimeEntry } from "../../domain/timesheet/entry";

/** Time added by hand, and what the timesheet says of each day. */
export interface TimesheetRepository {
  entry(id: EntryId): Result<TimeEntry | null, StorageError>;
  /** Entries that overlap `from` until `to`, oldest first. */
  entries(from: Timestamp, to: Timestamp): Result<TimeEntry[], StorageError>;
  /** Inserts or replaces the entry. */
  saveEntry(entry: TimeEntry): Result<void, StorageError>;
  removeEntry(id: EntryId): Result<void, StorageError>;
  /** The days from `from` to `to`, both included, that say anything; in order. */
  days(from: CalendarDay, to: CalendarDay): Result<TimesheetDay[], StorageError>;
  /** Keeps the day; one that says nothing is removed. */
  saveDay(day: TimesheetDay, at: Timestamp): Result<void, StorageError>;
}
