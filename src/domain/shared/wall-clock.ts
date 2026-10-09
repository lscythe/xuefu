import type { Timestamp } from "./time";

/** A moment as a person reads it on their own clock. */
export interface WallClock {
  readonly date: string;
  readonly time: string;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string | undefined): Intl.DateTimeFormat {
  const key = timeZone ?? "";
  let formatter = formatters.get(key);
  if (formatter === undefined) {
    formatter = new Intl.DateTimeFormat("en-GB", {
      weekday: "short",
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
      ...(timeZone === undefined ? {} : { timeZone }),
    });
    formatters.set(key, formatter);
  }
  return formatter;
}

/** "Tue 06 Oct" and "13:59"; the host time zone unless one is given. */
export function wallClock(at: Timestamp, timeZone?: string): WallClock {
  const parts: Partial<Record<Intl.DateTimeFormatPartTypes, string>> = {};
  for (const part of formatterFor(timeZone).formatToParts(at)) parts[part.type] = part.value;
  return {
    date: `${parts.weekday} ${parts.day} ${parts.month}`,
    time: `${parts.hour}:${parts.minute}`,
  };
}
