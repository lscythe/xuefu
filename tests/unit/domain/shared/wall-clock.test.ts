import { describe, expect, test } from "bun:test";
import type { Timestamp } from "../../../../src/domain/shared/time";
import { startOfDay, wallClock } from "../../../../src/domain/shared/wall-clock";

const at = (iso: string) => Date.parse(iso) as Timestamp;

describe("wallClock", () => {
  test("shows weekday, day, month and 24-hour time", () => {
    expect(wallClock(at("2026-10-06T13:59:41Z"), "UTC")).toEqual({
      date: "Tue 06 Oct",
      time: "13:59",
    });
  });

  test("pads single digits and uses 00 for midnight", () => {
    expect(wallClock(at("2026-01-04T00:05:00Z"), "UTC")).toEqual({
      date: "Sun 04 Jan",
      time: "00:05",
    });
  });

  test("renders in the given time zone", () => {
    expect(wallClock(at("2026-10-06T23:30:00Z"), "Asia/Jakarta")).toEqual({
      date: "Wed 07 Oct",
      time: "06:30",
    });
  });
});

describe("startOfDay", () => {
  test("is midnight on the clock in the given zone", () => {
    expect(startOfDay(at("2026-10-06T13:59:41.250Z"), "UTC")).toBe(at("2026-10-06T00:00:00Z"));
    expect(startOfDay(at("2026-10-06T23:30:00Z"), "Asia/Jakarta")).toBe(at("2026-10-06T17:00:00Z"));
    expect(startOfDay(at("2026-10-06T00:00:00Z"), "UTC")).toBe(at("2026-10-06T00:00:00Z"));
  });

  test("uses the host zone when none is given", () => {
    const now = at("2026-10-06T13:59:41Z");
    const midnight = new Date(now);
    midnight.setHours(0, 0, 0, 0);
    expect(startOfDay(now)).toBe(midnight.getTime() as Timestamp);
  });
});
