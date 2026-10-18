import { addDays, type CalendarDay, dayStart } from "../shared/calendar";
import type { Duration, Timestamp } from "../shared/time";
import { emptyDay, type TimesheetDay } from "./day";
import { type TrackedSpan, type TrackedTotal, trackedTotals } from "./tracked";

/** A day of the timesheet: the time tracked on it, and what is said of it. */
export interface DaySheet {
  readonly record: TimesheetDay;
  readonly start: Timestamp;
  readonly end: Timestamp;
  /** Spans that overlap the day, whole; oldest first. */
  readonly spans: readonly TrackedSpan[];
  readonly totals: readonly TrackedTotal[];
  readonly total: Duration;
}

/**
 * The days from `first` to `last`, each with the spans that overlap it and their totals counted
 * within the day and up to `now`. A span over midnight counts on both days, each its own part.
 */
export function daySheets(
  first: CalendarDay,
  last: CalendarDay,
  spans: readonly TrackedSpan[],
  records: readonly TimesheetDay[],
  now: Timestamp,
  timeZone?: string,
): DaySheet[] {
  const sheets: DaySheet[] = [];
  for (let day = first; day <= last; day = addDays(day, 1)) {
    const start = dayStart(day, timeZone);
    const end = dayStart(addDays(day, 1), timeZone);
    const own = spans.filter((span) => span.start < end && (span.end ?? now) > start);
    const totals = trackedTotals(own, start, Math.min(end, now) as Timestamp);
    sheets.push({
      record: records.find((record) => record.day === day) ?? emptyDay(day),
      start,
      end,
      spans: own,
      totals,
      total: totals.reduce((sum, total) => sum + total.duration, 0) as Duration,
    });
  }
  return sheets;
}
