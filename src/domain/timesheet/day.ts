import type { Brand } from "../shared/brand";
import type { CalendarDay } from "../shared/calendar";
import { type ValidationError, validationError } from "../shared/errors";
import { err, ok, type Result } from "../shared/result";

/** Where the day was worked from, such as an office's name. */
export type WorkPlace = Brand<string, "WorkPlace">;

/** What was done on a day, in a line or two, as the timesheet says it. */
export type DayTasks = Brand<string, "DayTasks">;

const MAX_PLACE = 80;
const MAX_TASKS = 2000;
// Control characters other than newlines, which tasks may be split into.
const CONTROL_CHARACTER = /[^\P{Cc}\n]/u;

function text<T>(
  raw: string,
  path: string,
  max: number,
  lines: boolean,
): Result<T | null, ValidationError> {
  const value = raw.replace(/\r\n?/g, "\n").trim();
  if (value === "") return ok(null);
  const problem =
    value.length > max
      ? `must be at most ${max} characters`
      : CONTROL_CHARACTER.test(value) || (!lines && value.includes("\n"))
        ? lines
          ? "must not contain control characters"
          : "must be one line"
        : null;
  if (problem === null) return ok(value as T);
  return err(validationError(`The day's ${path} is invalid`, [{ path, message: problem }]));
}

/** A work place as typed; blank is null, the usual place. */
export const workPlace = (raw: string) => text<WorkPlace>(raw, "place", MAX_PLACE, false);

/** A day's tasks as typed; blank is null, none written yet. */
export const dayTasks = (raw: string) => text<DayTasks>(raw, "tasks", MAX_TASKS, true);

/**
 * What the timesheet says of a day beyond the time tracked: where it was worked from, whether it
 * was a day off, and what was done. A day with none of these is not kept.
 */
export interface TimesheetDay {
  readonly day: CalendarDay;
  /** Null for the usual place. */
  readonly place: WorkPlace | null;
  readonly leave: boolean;
  readonly tasks: DayTasks | null;
}

export const emptyDay = (day: CalendarDay): TimesheetDay => ({
  day,
  place: null,
  leave: false,
  tasks: null,
});

export const isEmptyDay = (day: TimesheetDay): boolean =>
  day.place === null && !day.leave && day.tasks === null;
