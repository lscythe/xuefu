import type { Database } from "bun:sqlite";
import { beforeEach, describe, expect, test } from "bun:test";
import type { CalendarDay } from "../../../../src/domain/shared/calendar";
import type { EntryId, WorkspaceId } from "../../../../src/domain/shared/ids";
import type { Timestamp } from "../../../../src/domain/shared/time";
import type { DayTasks, TimesheetDay, WorkPlace } from "../../../../src/domain/timesheet/day";
import type { Category, EntryNote, TimeEntry } from "../../../../src/domain/timesheet/entry";
import type { IssueKey } from "../../../../src/domain/work/issue-key";
import { SqliteTimesheetRepository } from "../../../../src/infrastructure/persistence/sqlite/timesheet-repository";
import { migratedMemoryDatabase } from "../../../support/database";

const at = (minutes: number) => (1_760_000_000_000 + minutes * 60_000) as Timestamp;
const entry = (id: string, start: number, end: number, issue: string | null = null): TimeEntry => ({
  id: id as EntryId,
  workspaceId: "mobile-banking" as WorkspaceId,
  issueKey: issue as IssueKey | null,
  category: issue === null ? ("Meeting" as Category) : null,
  start: at(start),
  end: at(end),
  note: issue === null ? ("Planning" as EntryNote) : null,
});
const day = (raw: string, fields: Partial<TimesheetDay> = {}): TimesheetDay => ({
  day: raw as CalendarDay,
  place: null,
  leave: false,
  tasks: null,
  ...fields,
});

let db: Database;
let timesheet: SqliteTimesheetRepository;
beforeEach(() => {
  db = migratedMemoryDatabase();
  timesheet = new SqliteTimesheetRepository(db);
});

describe("SqliteTimesheetRepository", () => {
  test("entries are found by id, and by the time they overlap, oldest first", () => {
    const later = entry("e1", 60, 90, "MOB-1");
    const earlier = entry("e2", 0, 30);
    timesheet.saveEntry(later);
    timesheet.saveEntry(earlier);
    expect(timesheet.entry("e2" as EntryId)).toEqual({ ok: true, value: earlier });
    expect(timesheet.entry("e9" as EntryId)).toEqual({ ok: true, value: null });
    expect(timesheet.entries(at(0), at(100))).toEqual({ ok: true, value: [earlier, later] });
    expect(timesheet.entries(at(29), at(61))).toEqual({ ok: true, value: [earlier, later] });
    // Touching is not overlapping.
    expect(timesheet.entries(at(30), at(60))).toEqual({ ok: true, value: [] });
  });

  test("saving again replaces the entry; removing forgets it", () => {
    timesheet.saveEntry(entry("e1", 0, 30));
    const changed = { ...entry("e1", 10, 40, "MOB-2") };
    timesheet.saveEntry(changed);
    expect(timesheet.entry("e1" as EntryId)).toEqual({ ok: true, value: changed });
    expect(timesheet.removeEntry("e1" as EntryId)).toEqual({ ok: true, value: undefined });
    expect(timesheet.entries(at(0), at(100))).toEqual({ ok: true, value: [] });
  });

  test("storage refuses an entry ending before it starts, or on both an issue and a category", () => {
    expect(timesheet.saveEntry({ ...entry("e1", 30, 30) }).ok).toBe(false);
    expect(
      timesheet.saveEntry({ ...entry("e1", 0, 30, "MOB-1"), category: "Meeting" as Category }).ok,
    ).toBe(false);
  });

  test("days are kept in order; one saying nothing is removed", () => {
    const leave = day("2026-09-10", { leave: true });
    const worked = day("2026-09-08", {
      place: "Head office" as WorkPlace,
      tasks: "Login: fixed.\nRelease: tagged." as DayTasks,
    });
    timesheet.saveDay(leave, at(0));
    timesheet.saveDay(worked, at(0));
    expect(timesheet.days("2026-09-01" as CalendarDay, "2026-09-30" as CalendarDay)).toEqual({
      ok: true,
      value: [worked, leave],
    });
    expect(timesheet.days("2026-09-09" as CalendarDay, "2026-09-10" as CalendarDay)).toEqual({
      ok: true,
      value: [leave],
    });
    timesheet.saveDay(day("2026-09-10"), at(1));
    expect(timesheet.days("2026-09-10" as CalendarDay, "2026-09-10" as CalendarDay)).toEqual({
      ok: true,
      value: [],
    });
  });

  test("corrupt rows are a storage error", () => {
    timesheet.saveEntry(entry("e1", 0, 30, "MOB-1"));
    db.run("UPDATE time_entries SET issue_key = 'not a key'");
    expect(timesheet.entry("e1" as EntryId)).toMatchObject({
      ok: false,
      error: { kind: "storage", message: "Stored timesheet data is corrupt" },
    });
    expect(timesheet.entries(at(0), at(100)).ok).toBe(false);
    db.run("UPDATE time_entries SET issue_key = NULL, category = 'a\tb'");
    expect(timesheet.entry("e1" as EntryId).ok).toBe(false);
    db.run("UPDATE time_entries SET category = 'Meeting', note = 'a\nb'");
    expect(timesheet.entry("e1" as EntryId).ok).toBe(false);
    db.run("UPDATE time_entries SET note = NULL, workspace_id = 'Bad Id'");
    expect(timesheet.entry("e1" as EntryId).ok).toBe(false);

    timesheet.saveDay(day("2026-09-10", { leave: true }), at(0));
    db.run("UPDATE timesheet_days SET place = 'a\nb'");
    expect(timesheet.days("2026-09-01" as CalendarDay, "2026-09-30" as CalendarDay).ok).toBe(false);
  });

  test("rows of the wrong shape are a storage error", () => {
    const fresh = migratedMemoryDatabase();
    fresh.run("DROP TABLE time_entries");
    fresh.run(
      "CREATE TABLE time_entries (id, workspace_id, issue_key, category, start_at, end_at, note)",
    );
    fresh.run("INSERT INTO time_entries VALUES ('e1', 'mobile', NULL, 'Meeting', 'soon', 5, NULL)");
    const repository = new SqliteTimesheetRepository(fresh);
    expect(repository.entry("e1" as EntryId).ok).toBe(false);
    fresh.run("UPDATE time_entries SET start_at = 9, end_at = 5");
    expect(repository.entry("e1" as EntryId).ok).toBe(false);
    fresh.run("DROP TABLE timesheet_days");
    fresh.run("CREATE TABLE timesheet_days (day, place, leave, tasks, updated_at)");
    fresh.run("INSERT INTO timesheet_days VALUES ('2026-09-31', NULL, 1, NULL, 0)");
    expect(repository.days("2026-09-01" as CalendarDay, "2026-09-31" as CalendarDay).ok).toBe(
      false,
    );
    fresh.run("UPDATE timesheet_days SET day = '2026-09-30', leave = 2");
    expect(repository.days("2026-09-01" as CalendarDay, "2026-09-30" as CalendarDay).ok).toBe(
      false,
    );
    fresh.run("UPDATE timesheet_days SET leave = 'yes'");
    expect(repository.days("2026-09-01" as CalendarDay, "2026-09-30" as CalendarDay).ok).toBe(
      false,
    );
  });

  test("a closed database reports read, save and remove failures", () => {
    db.close();
    expect(timesheet.entry("e1" as EntryId)).toMatchObject({
      ok: false,
      error: { operation: "timesheet.read" },
    });
    expect(timesheet.entries(at(0), at(1)).ok).toBe(false);
    expect(timesheet.days("2026-09-01" as CalendarDay, "2026-09-30" as CalendarDay).ok).toBe(false);
    expect(timesheet.saveEntry(entry("e1", 0, 30))).toMatchObject({
      ok: false,
      error: { operation: "timesheet.save", message: "Unable to save the time entry" },
    });
    expect(timesheet.saveDay(day("2026-09-01", { leave: true }), at(0))).toMatchObject({
      ok: false,
      error: { message: "Unable to save the day" },
    });
    expect(timesheet.removeEntry("e1" as EntryId)).toMatchObject({
      ok: false,
      error: { operation: "timesheet.remove" },
    });
  });
});
