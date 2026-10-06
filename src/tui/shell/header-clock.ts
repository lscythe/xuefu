import type { Timestamp } from "../../domain/shared/time";

export interface HeaderClock {
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
export function headerClock(at: Timestamp, timeZone?: string): HeaderClock {
  const parts: Partial<Record<Intl.DateTimeFormatPartTypes, string>> = {};
  for (const part of formatterFor(timeZone).formatToParts(at)) parts[part.type] = part.value;
  return {
    date: `${parts.weekday} ${parts.day} ${parts.month}`,
    time: `${parts.hour}:${parts.minute}`,
  };
}
