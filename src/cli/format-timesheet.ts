import { longDate } from "../domain/shared/calendar";
import { type Duration, shortDuration, type Timestamp } from "../domain/shared/time";
import { wallClock } from "../domain/shared/wall-clock";
import type { DaySheet } from "../domain/timesheet/sheet";
import { spanId, type TrackedSpan } from "../domain/timesheet/tracked";
import type { Workspace } from "../domain/workspace/workspace";
import { table } from "./format";

type Names = ReadonlyMap<string, Workspace>;

const time = (at: Timestamp, timeZone?: string) => wallClock(at, timeZone).time;

/** What a span was on: its issue, its category, or its workspace's name. */
function subject(span: Pick<TrackedSpan, "issueKey" | "category" | "workspaceId">, names: Names) {
  return span.issueKey ?? span.category ?? names.get(span.workspaceId)?.name ?? span.workspaceId;
}

/** What is said of a day besides its time: leave, place, tasks. */
function dayRemarks(sheet: DaySheet): string[] {
  const { leave, place, tasks } = sheet.record;
  return [
    ...(leave ? ["Leave"] : []),
    ...(place === null ? [] : [`At ${place}`]),
    ...(tasks === null ? [] : tasks.split("\n").map((line) => `Tasks: ${line}`)),
  ];
}

/** A day: each stretch of time with its id, what it was on and its note, then the totals. */
export function formatDay(
  sheet: DaySheet,
  names: Names,
  now: Timestamp,
  timeZone?: string,
): string {
  const heading = `${longDate(sheet.record.day)}  ${shortDuration(sheet.total)}`;
  const remarks = dayRemarks(sheet).map((line) => `  ${line}`);
  if (sheet.spans.length === 0) {
    return [heading, ...remarks, "  Nothing tracked.", ""].join("\n");
  }
  // Time over midnight shows as its part of this day, from or until midnight.
  const rows = sheet.spans.map((span) => {
    const start = Math.max(span.start, sheet.start) as Timestamp;
    const end = Math.min(span.end ?? now, sheet.end) as Timestamp;
    const until = span.end === null ? "now  " : end === sheet.end ? "24:00" : time(end, timeZone);
    return [
      `${time(start, timeZone)}-${until}`,
      shortDuration((end - start) as Duration),
      subject(span, names),
      span.note ?? (span.source.kind === "timer" ? "timed" : ""),
      spanId(span.source),
    ];
  });
  const totals = sheet.totals.map((total) => [
    "",
    shortDuration(total.duration),
    subject(total, names),
  ]);
  const lines = table([["TIME", "LENGTH", "ON", "NOTE", "ID"], ...rows, [], ...totals]);
  return [heading, ...remarks, "", lines].join("\n");
}

/** Several days, a line each: the date, the total, and what is said of it. */
export function formatDays(sheets: readonly DaySheet[]): string {
  const total = sheets.reduce((sum, sheet) => sum + sheet.total, 0) as Duration;
  return table([
    ["DATE", "TIME", "NOTES"],
    ...sheets.map((sheet) => [
      longDate(sheet.record.day),
      sheet.total === 0 ? "-" : shortDuration(sheet.total),
      dayRemarks(sheet).join("; "),
    ]),
    ["Total", shortDuration(total), ""],
  ]);
}

/** A day as JSON, for scripts and agents. */
export function dayJson(sheet: DaySheet, names: Names, now: Timestamp) {
  return {
    day: sheet.record.day,
    place: sheet.record.place,
    leave: sheet.record.leave,
    tasks: sheet.record.tasks,
    totalMs: sheet.total,
    spans: sheet.spans.map((span) => ({
      id: spanId(span.source),
      kind: span.source.kind,
      workspaceId: span.workspaceId,
      workspaceName: names.get(span.workspaceId)?.name ?? null,
      issueKey: span.issueKey,
      category: span.category,
      start: new Date(span.start).toISOString(),
      end: span.end === null ? null : new Date(span.end).toISOString(),
      durationMs: (span.end ?? now) - span.start,
      note: span.note,
    })),
  };
}
