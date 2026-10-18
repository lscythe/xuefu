import { describe, expect, test } from "bun:test";
import { dayJson, formatDay, formatDays } from "../../../src/cli/format-timesheet";
import type { CalendarDay } from "../../../src/domain/shared/calendar";
import type { EntryId, TimerId, WorkspaceId } from "../../../src/domain/shared/ids";
import type { Timestamp } from "../../../src/domain/shared/time";
import type { DayTasks, WorkPlace } from "../../../src/domain/timesheet/day";
import type { Category, EntryNote } from "../../../src/domain/timesheet/entry";
import { groupScope } from "../../../src/domain/timesheet/scope";
import { type DaySheet, daySheets } from "../../../src/domain/timesheet/sheet";
import type { TrackedSpan } from "../../../src/domain/timesheet/tracked";
import type { IssueKey } from "../../../src/domain/work/issue-key";
import type { GroupName, Workspace } from "../../../src/domain/workspace/workspace";

const MONDAY = "2026-09-07" as CalendarDay;
const TUESDAY = "2026-09-08" as CalendarDay;
const at = (day: number, hour: number, minute = 0) =>
  Date.UTC(2026, 8, 7 + day, hour, minute) as Timestamp;
const NOW = at(1, 11);

const names = new Map([["mobile", { id: "mobile", name: "Mobile Banking" } as Workspace]]);

const BANKING = groupScope("Banking" as GroupName);

const overnight: TrackedSpan = {
  source: { kind: "timer", id: "t1" as TimerId, position: 0 },
  workspaceId: "mobile" as WorkspaceId,
  scope: BANKING,
  issueKey: null,
  category: null,
  start: at(0, 22),
  end: at(1, 1),
  note: null,
};
const meeting: TrackedSpan = {
  source: { kind: "entry", id: "ent-1" as EntryId },
  workspaceId: null,
  scope: BANKING,
  issueKey: null,
  category: "Meeting" as Category,
  start: at(1, 9),
  end: at(1, 9, 30),
  note: "Planning" as EntryNote,
};
const running: TrackedSpan = {
  ...overnight,
  source: { kind: "timer", id: "t2" as TimerId, position: 1 },
  issueKey: "MOB-1" as IssueKey,
  start: at(1, 10),
  end: null,
};

const record = {
  day: TUESDAY,
  place: "Office" as WorkPlace,
  leave: true,
  tasks: "Login: fixed.\nReview: done." as DayTasks,
};

const sheets = (): DaySheet[] =>
  daySheets(MONDAY, TUESDAY, [overnight, meeting, running], [record], NOW, "UTC");

describe("formatDay", () => {
  test("lists each stretch clipped to the day, with its id and note, then the totals", () => {
    const [monday, tuesday] = sheets();
    if (monday === undefined || tuesday === undefined) throw new Error("two days expected");
    const first = formatDay(monday, names, NOW, "UTC");
    expect(first).toStartWith("7 September 2026  2h 00m\n\n");
    expect(first).toMatch(/22:00-24:00 +2h 00m +Mobile Banking +timed +t1:0/);
    const second = formatDay(tuesday, names, NOW, "UTC");
    expect(second).toStartWith(
      "8 September 2026  2h 30m\n  Leave\n  At Office\n  Tasks: Login: fixed.\n  Tasks: Review: done.\n",
    );
    expect(second).toMatch(/00:00-01:00 +1h 00m +Mobile Banking +timed +t1:0/);
    expect(second).toMatch(/09:00-09:30 +30m +Meeting +Planning +ent-1/);
    expect(second).toMatch(/10:00-now +1h 00m +MOB-1 +timed +t2:1\n\n/);
    expect(second).toMatch(/\n +1h 00m +MOB-1\n/);
    expect(second).toEndWith("30m     Meeting\n");
  });

  test("a day with nothing tracked says so", () => {
    const [empty] = daySheets(MONDAY, MONDAY, [], [], NOW, "UTC");
    if (empty === undefined) throw new Error("a day expected");
    expect(formatDay(empty, names, NOW, "UTC")).toBe("7 September 2026  0m\n  Nothing tracked.\n");
  });

  test("a workspace no longer known shows by its id", () => {
    const [monday] = sheets();
    if (monday === undefined) throw new Error("a day expected");
    expect(formatDay(monday, new Map(), NOW, "UTC")).toContain("mobile");
  });

  test("time on a whole group with nothing else to name shows the group", () => {
    const bare = { ...meeting, category: null };
    const [tuesday] = daySheets(TUESDAY, TUESDAY, [bare], [], NOW, "UTC");
    if (tuesday === undefined) throw new Error("a day expected");
    expect(formatDay(tuesday, names, NOW, "UTC")).toMatch(/09:00-09:30 +30m +Banking/);
  });
});

describe("formatDays", () => {
  test("a line a day with its total and remarks, then the total of all", () => {
    const lines = formatDays(sheets()).split("\n");
    expect(lines[0]).toMatch(/^DATE +TIME +NOTES/);
    expect(lines[1]).toMatch(/^7 September 2026 +2h 00m/);
    expect(lines[2]).toMatch(
      /^8 September 2026 +2h 30m +Leave; At Office; Tasks: Login: fixed\.; Tasks: Review: done\./,
    );
    expect(lines[3]).toMatch(/^Total +4h 30m/);
  });

  test("a day without time shows a dash", () => {
    expect(formatDays(daySheets(MONDAY, MONDAY, [], [], NOW, "UTC"))).toMatch(
      /7 September 2026 +-/,
    );
  });
});

describe("dayJson", () => {
  test("a day for scripts: what is said of it, and each span with its id and length", () => {
    const [, tuesday] = sheets();
    if (tuesday === undefined) throw new Error("a day expected");
    expect<unknown>(dayJson(tuesday, BANKING, names, NOW)).toEqual({
      timesheet: { kind: "group", group: "Banking", workspaceId: null, name: "Banking" },
      day: TUESDAY,
      place: "Office",
      leave: true,
      tasks: "Login: fixed.\nReview: done.",
      totalMs: 2.5 * 3_600_000,
      spans: [
        {
          id: "t1:0",
          kind: "timer",
          workspaceId: "mobile",
          workspaceName: "Mobile Banking",
          group: "Banking",
          issueKey: null,
          category: null,
          start: "2026-09-07T22:00:00.000Z",
          end: "2026-09-08T01:00:00.000Z",
          durationMs: 3 * 3_600_000,
          note: null,
        },
        {
          id: "ent-1",
          kind: "entry",
          workspaceId: null,
          workspaceName: null,
          group: "Banking",
          issueKey: null,
          category: "Meeting",
          start: "2026-09-08T09:00:00.000Z",
          end: "2026-09-08T09:30:00.000Z",
          durationMs: 30 * 60_000,
          note: "Planning",
        },
        {
          id: "t2:1",
          kind: "timer",
          workspaceId: "mobile",
          workspaceName: "Mobile Banking",
          group: "Banking",
          issueKey: "MOB-1",
          category: null,
          start: "2026-09-08T10:00:00.000Z",
          end: null,
          durationMs: 3_600_000,
          note: null,
        },
      ],
    });
    const unknown = dayJson(tuesday, null, new Map(), NOW);
    expect(unknown.timesheet).toBeNull();
    expect(unknown.spans[0]?.workspaceName).toBeNull();
  });

  test("a workspace's own timesheet is named by the workspace", () => {
    const own = { kind: "workspace", workspaceId: "mobile" as WorkspaceId } as const;
    const [monday] = daySheets(MONDAY, MONDAY, [], [], NOW, "UTC");
    if (monday === undefined) throw new Error("a day expected");
    expect<unknown>(dayJson(monday, own, names, NOW).timesheet).toEqual({
      kind: "workspace",
      group: null,
      workspaceId: "mobile",
      name: "Mobile Banking",
    });
  });
});
