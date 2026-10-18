import { describe, expect, test } from "bun:test";
import {
  addDays,
  type CalendarDay,
  type CalendarMonth,
  calendarDay,
  calendarMonth,
  dayOf,
  dayStart,
  daysOf,
  longDate,
  longMonth,
  minutesOf,
  monthOf,
  weekday,
  weekStart,
} from "../../../../src/domain/shared/calendar";
import type { Timestamp } from "../../../../src/domain/shared/time";

const day = (raw: string) => raw as CalendarDay;

describe("calendar days", () => {
  test("a day is a real date written as 2026-09-01", () => {
    expect(calendarDay("2026-09-30")).toEqual({ ok: true, value: day("2026-09-30") });
    expect(calendarDay("2028-02-29").ok).toBe(true);
    for (const wrong of ["2026-09-31", "2026-02-29", "2026-13-01", "2026-9-1", "today", ""]) {
      expect(calendarDay(wrong)).toMatchObject({ ok: false, error: { kind: "validation" } });
    }
  });

  test("a month is written as 2026-09", () => {
    expect(calendarMonth("2026-09")).toEqual({ ok: true, value: "2026-09" as CalendarMonth });
    for (const wrong of ["2026-00", "2026-13", "2026-9", "Sept"]) {
      expect(calendarMonth(wrong).ok).toBe(false);
    }
  });

  test("days are counted across months and years", () => {
    expect(addDays(day("2026-09-30"), 1)).toBe(day("2026-10-01"));
    expect(addDays(day("2026-01-01"), -1)).toBe(day("2025-12-31"));
    expect(weekday(day("2026-09-07"))).toBe(1);
    expect(weekStart(day("2026-09-13"))).toBe(day("2026-09-07"));
    expect(weekStart(day("2026-09-07"))).toBe(day("2026-09-07"));
    expect(monthOf(day("2026-09-13"))).toBe("2026-09" as CalendarMonth);
    expect(daysOf("2026-02" as CalendarMonth)).toHaveLength(28);
    expect(daysOf("2026-09" as CalendarMonth).at(-1)).toBe(day("2026-09-30"));
  });

  test("a moment falls on a day of the clock in a time zone, which starts at its midnight", () => {
    const tokyoMorning = Date.UTC(2026, 8, 30, 18, 0) as Timestamp; // 03:00 on 1 October there
    expect(dayOf(tokyoMorning, "Asia/Tokyo")).toBe(day("2026-10-01"));
    expect(dayOf(tokyoMorning, "UTC")).toBe(day("2026-09-30"));
    expect(dayStart(day("2026-10-01"), "Asia/Tokyo")).toBe(Date.UTC(2026, 8, 30, 15) as Timestamp);
    expect(dayStart(day("2026-10-01"), "UTC")).toBe(Date.UTC(2026, 9, 1) as Timestamp);
    // Far from UTC, noon UTC is already the next day; it still finds the right midnight.
    expect(dayStart(day("2026-10-01"), "Pacific/Kiritimati")).toBe(
      Date.UTC(2026, 8, 30, 10) as Timestamp,
    );
    expect(dayStart(day("2026-10-01"), "Pacific/Pago_Pago")).toBe(
      Date.UTC(2026, 9, 1, 11) as Timestamp,
    );
  });

  test("written out for people, and times of day read from 07:30", () => {
    expect(longDate(day("2026-09-01"))).toBe("1 September 2026");
    expect(longMonth("2026-09" as CalendarMonth)).toBe("September 2026");
    expect(minutesOf("07:30")).toBe(450);
    expect(minutesOf(" 9:05 ")).toBe(545);
    for (const wrong of ["24:00", "7:60", "730", "seven"]) expect(minutesOf(wrong)).toBeNull();
  });
});
