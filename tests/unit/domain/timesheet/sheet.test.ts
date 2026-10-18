import { describe, expect, test } from "bun:test";
import type { CalendarDay } from "../../../../src/domain/shared/calendar";
import type { EntryId, TimerId, WorkspaceId } from "../../../../src/domain/shared/ids";
import type { Timestamp } from "../../../../src/domain/shared/time";
import type { DayTasks, WorkPlace } from "../../../../src/domain/timesheet/day";
import type { Category, EntryNote } from "../../../../src/domain/timesheet/entry";
import { daySheets } from "../../../../src/domain/timesheet/sheet";
import type { TrackedSpan } from "../../../../src/domain/timesheet/tracked";
import type { IssueKey } from "../../../../src/domain/work/issue-key";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const MONDAY = "2026-09-07" as CalendarDay;
const TUESDAY = "2026-09-08" as CalendarDay;
const at = (day: number, hour: number, minute = 0) =>
  Date.UTC(2026, 8, 7 + day, hour, minute) as Timestamp;

const timed: TrackedSpan = {
  source: { kind: "timer", id: "t1" as TimerId, position: 0 },
  workspaceId: "mobile" as WorkspaceId,
  issueKey: "MOB-1" as IssueKey,
  category: null,
  start: at(0, 22),
  end: at(1, 1),
  note: null,
};
const meeting: TrackedSpan = {
  source: { kind: "entry", id: "ent-1" as EntryId },
  workspaceId: "mobile" as WorkspaceId,
  issueKey: null,
  category: "Meeting" as Category,
  start: at(1, 9),
  end: at(1, 9, 30),
  note: "Planning" as EntryNote,
};
const running: TrackedSpan = { ...timed, start: at(1, 10), end: null };

describe("daySheets", () => {
  test("each day has the spans that overlap it, counted within the day and up to now", () => {
    const sheets = daySheets(MONDAY, TUESDAY, [timed, meeting, running], [], at(1, 11), "UTC");
    expect(sheets.map((s) => [s.record.day, s.start, s.end, s.spans.length, s.total])).toEqual([
      [MONDAY, at(0, 0), at(1, 0), 1, 2 * HOUR],
      [TUESDAY, at(1, 0), at(2, 0), 3, 2.5 * HOUR],
    ]);
    expect<unknown>(sheets[1]?.totals.map((t) => [t.issueKey ?? t.category, t.duration])).toEqual([
      ["MOB-1", 2 * HOUR],
      ["Meeting", 30 * MINUTE],
    ]);
  });

  test("a day keeps what is said of it, and a day with nothing said is empty", () => {
    const record = {
      day: TUESDAY,
      place: "Office" as WorkPlace,
      leave: true,
      tasks: "Login: fixed." as DayTasks,
    };
    const [monday, tuesday] = daySheets(MONDAY, TUESDAY, [], [record], at(1, 11), "UTC");
    expect(monday).toMatchObject({
      record: { day: MONDAY, place: null, leave: false, tasks: null },
      spans: [],
      totals: [],
      total: 0,
    });
    expect(tuesday?.record).toEqual(record);
  });

  test("no days when the last comes before the first", () => {
    expect(daySheets(TUESDAY, MONDAY, [timed], [], at(1, 11), "UTC")).toEqual([]);
  });
});
