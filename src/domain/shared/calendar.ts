import type { Brand } from "./brand";
import { type ValidationError, validationError } from "./errors";
import { err, ok, type Result } from "./result";
import type { Timestamp } from "./time";
import { startOfDay } from "./wall-clock";

/** A day on the calendar, "2026-09-01"; not a moment, so no time zone. */
export type CalendarDay = Brand<string, "CalendarDay">;

/** A month on the calendar, "2026-09". */
export type CalendarMonth = Brand<string, "CalendarMonth">;

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONTH = /^(\d{4})-(\d{2})$/;

const pad = (value: number): string => String(value).padStart(2, "0");

/** Days in `month` (1-12) of `year`. */
const daysIn = (year: number, month: number): number =>
  new Date(Date.UTC(year, month, 0)).getUTCDate();

export function calendarDay(raw: string): Result<CalendarDay, ValidationError> {
  const match = DAY.exec(raw);
  const [year, month, day] = [Number(match?.[1]), Number(match?.[2]), Number(match?.[3])];
  if (match === null || month < 1 || month > 12 || day < 1 || day > daysIn(year, month)) {
    return err(
      validationError("Day is invalid", [{ path: "day", message: "a date such as 2026-09-01" }], {
        raw,
      }),
    );
  }
  return ok(raw as CalendarDay);
}

export function calendarMonth(raw: string): Result<CalendarMonth, ValidationError> {
  const match = MONTH.exec(raw);
  const month = Number(match?.[2]);
  if (match === null || month < 1 || month > 12) {
    return err(
      validationError("Month is invalid", [{ path: "month", message: "a month such as 2026-09" }], {
        raw,
      }),
    );
  }
  return ok(raw as CalendarMonth);
}

const parts = (day: CalendarDay): [number, number, number] => {
  const [year, month, date] = day.split("-").map(Number);
  return [year ?? 0, month ?? 0, date ?? 0];
};

/** The day `count` days after `day`; before it when negative. */
export function addDays(day: CalendarDay, count: number): CalendarDay {
  const [year, month, date] = parts(day);
  const next = new Date(Date.UTC(year, month - 1, date + count));
  return `${next.getUTCFullYear()}-${pad(next.getUTCMonth() + 1)}-${pad(next.getUTCDate())}` as CalendarDay;
}

/** 0 for Sunday to 6 for Saturday. */
export function weekday(day: CalendarDay): number {
  const [year, month, date] = parts(day);
  return new Date(Date.UTC(year, month - 1, date)).getUTCDay();
}

/** The Monday of `day`'s week. */
export const weekStart = (day: CalendarDay): CalendarDay => addDays(day, -((weekday(day) + 6) % 7));

export const monthOf = (day: CalendarDay): CalendarMonth => day.slice(0, 7) as CalendarMonth;

/** Every day of `month`, in order. */
export function daysOf(month: CalendarMonth): CalendarDay[] {
  const [year, number] = month.split("-").map(Number);
  const count = daysIn(year ?? 0, number ?? 0);
  return Array.from({ length: count }, (_, index) => `${month}-${pad(index + 1)}` as CalendarDay);
}

const dayFormatters = new Map<string, Intl.DateTimeFormat>();

/** The day `at` falls on, on the clock in `timeZone`; the host's unless one is given. */
export function dayOf(at: Timestamp, timeZone?: string): CalendarDay {
  const key = timeZone ?? "";
  let formatter = dayFormatters.get(key);
  if (formatter === undefined) {
    // en-CA writes dates as 2026-09-01.
    formatter = new Intl.DateTimeFormat("en-CA", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      ...(timeZone === undefined ? {} : { timeZone }),
    });
    dayFormatters.set(key, formatter);
  }
  return formatter.format(at) as CalendarDay;
}

/**
 * Midnight starting `day` on the clock in `timeZone`. Found from noon that day, so a clock change
 * at night moves it by no more than the change.
 */
export function dayStart(day: CalendarDay, timeZone?: string): Timestamp {
  const [year, month, date] = parts(day);
  const noon = Date.UTC(year, month - 1, date, 12) as Timestamp;
  const guess = startOfDay(noon, timeZone);
  // Noon UTC can fall on the next or previous local day far from UTC; step back onto `day`.
  const local = dayOf(guess, timeZone);
  if (local === day) return guess;
  const shift = local < day ? 1 : -1;
  return startOfDay((guess + shift * 24 * 3_600_000) as Timestamp, timeZone);
}

/** "1 September 2026". */
export function longDate(day: CalendarDay): string {
  const [year, month, date] = parts(day);
  const name = new Intl.DateTimeFormat("en-GB", { month: "long", timeZone: "UTC" }).format(
    Date.UTC(year, month - 1, 1),
  );
  return `${date} ${name} ${year}`;
}

/** "September 2026". */
export function longMonth(month: CalendarMonth): string {
  return longDate(`${month}-01` as CalendarDay).replace(/^1 /, "");
}

/** Minutes after midnight in "07:30"; null when it is not a time of day. */
export function minutesOf(raw: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(raw.trim());
  if (match === null) return null;
  const [hours, minutes] = [Number(match[1]), Number(match[2])];
  return hours > 23 || minutes > 59 ? null : hours * 60 + minutes;
}
