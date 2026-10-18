import { describe, expect, test } from "bun:test";
import type { CalendarDay } from "../../../../src/domain/shared/calendar";
import type { EntryId, WorkspaceId } from "../../../../src/domain/shared/ids";
import type { Timestamp } from "../../../../src/domain/shared/time";
import { dayTasks, emptyDay, isEmptyDay, workPlace } from "../../../../src/domain/timesheet/day";
import {
  type Category,
  category,
  entryNote,
  timeEntry,
} from "../../../../src/domain/timesheet/entry";
import type { IssueKey } from "../../../../src/domain/work/issue-key";
import type { GroupName } from "../../../../src/domain/workspace/workspace";

const HOUR = 3_600_000;
const entry = {
  id: "e1" as EntryId,
  workspaceId: "mobile" as WorkspaceId,
  group: null,
  issueKey: null,
  category: "Meeting" as Category,
  start: (10 * HOUR) as Timestamp,
  end: (11 * HOUR) as Timestamp,
  note: null,
};

describe("time entries", () => {
  test("a category and a note are one line, trimmed; a blank note is none", () => {
    expect(category("  Meeting ")).toEqual({ ok: true, value: "Meeting" as Category });
    expect(category(" ").ok).toBe(false);
    expect(category("x".repeat(41)).ok).toBe(false);
    expect(category("a\tb").ok).toBe(false);
    expect(entryNote("  ")).toEqual({ ok: true, value: null });
    expect(entryNote(" Sprint planning ")).toMatchObject({ ok: true, value: "Sprint planning" });
    expect(entryNote("a\nb")).toMatchObject({ ok: false, error: { issues: [{ path: "note" }] } });
    expect(entryNote("x".repeat(2001)).ok).toBe(false);
  });

  test("an entry ends after it starts, within a day, on an issue or in a category", () => {
    expect(timeEntry(entry)).toEqual({ ok: true, value: entry });
    expect(timeEntry({ ...entry, end: entry.start })).toMatchObject({
      ok: false,
      error: { issues: [{ path: "to", message: "must be after the start" }] },
    });
    expect(timeEntry({ ...entry, end: (entry.start + 25 * HOUR) as Timestamp })).toMatchObject({
      error: { issues: [{ message: "must be within a day of the start" }] },
    });
    expect(timeEntry({ ...entry, category: null })).toMatchObject({
      error: { issues: [{ path: "category" }] },
    });
    expect(timeEntry({ ...entry, issueKey: "MOB-1" as IssueKey }).ok).toBe(false);
    expect(timeEntry({ ...entry, issueKey: "MOB-1" as IssueKey, category: null }).ok).toBe(true);
  });

  test("an entry is on a workspace or a whole group, one of them", () => {
    const onGroup = { ...entry, workspaceId: null, group: "Banking" as GroupName };
    expect(timeEntry(onGroup)).toEqual({ ok: true, value: onGroup });
    expect(timeEntry({ ...entry, group: "Banking" as GroupName })).toMatchObject({
      error: { issues: [{ path: "group", message: "give a workspace or a group, one of them" }] },
    });
    expect(timeEntry({ ...entry, workspaceId: null }).ok).toBe(false);
  });
});

describe("timesheet days", () => {
  test("a place is one line, tasks may be several; blank is none", () => {
    expect<unknown>(workPlace(" Office ")).toEqual({ ok: true, value: "Office" });
    expect(workPlace("")).toEqual({ ok: true, value: null });
    expect(workPlace("a\nb")).toMatchObject({
      ok: false,
      error: { issues: [{ path: "place", message: "must be one line" }] },
    });
    expect(workPlace("x".repeat(81)).ok).toBe(false);
    expect<unknown>(dayTasks("Login: fixed.\r\nRelease: tagged.")).toEqual({
      ok: true,
      value: "Login: fixed.\nRelease: tagged.",
    });
    expect(dayTasks("a\u0007b")).toMatchObject({
      error: { issues: [{ path: "tasks", message: "must not contain control characters" }] },
    });
  });

  test("a day saying nothing is empty", () => {
    const today = emptyDay("2026-09-01" as CalendarDay);
    expect(isEmptyDay(today)).toBe(true);
    expect(isEmptyDay({ ...today, leave: true })).toBe(false);
  });
});
