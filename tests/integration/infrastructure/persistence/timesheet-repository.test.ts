import type { Database } from "bun:sqlite";
import { beforeEach, describe, expect, test } from "bun:test";
import type { CalendarDay } from "../../../../src/domain/shared/calendar";
import type { EntryId, WorkspaceId } from "../../../../src/domain/shared/ids";
import type { Timestamp } from "../../../../src/domain/shared/time";
import type { DayTasks, TimesheetDay, WorkPlace } from "../../../../src/domain/timesheet/day";
import type { Category, EntryNote, TimeEntry } from "../../../../src/domain/timesheet/entry";
import type { TimesheetScope } from "../../../../src/domain/timesheet/scope";
import type { IssueKey } from "../../../../src/domain/work/issue-key";
import type { GroupName } from "../../../../src/domain/workspace/workspace";
import { SqliteTimesheetRepository } from "../../../../src/infrastructure/persistence/sqlite/timesheet-repository";
import { migratedMemoryDatabase } from "../../../support/database";

const at = (minutes: number) => (1_760_000_000_000 + minutes * 60_000) as Timestamp;
const entry = (id: string, start: number, end: number, issue: string | null = null): TimeEntry => ({
  id: id as EntryId,
  workspaceId: "mobile-banking" as WorkspaceId,
  group: null,
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
const BANKING: TimesheetScope = { kind: "group", group: "Banking" as GroupName };
const SIDE: TimesheetScope = { kind: "workspace", workspaceId: "side-project" as WorkspaceId };
const SEPTEMBER = ["2026-09-01", "2026-09-30"] as [CalendarDay, CalendarDay];

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

  test("an entry on a whole group reads back without a workspace", () => {
    const meeting = { ...entry("e1", 0, 30), workspaceId: null, group: "Banking" as GroupName };
    timesheet.saveEntry(meeting);
    expect(timesheet.entry("e1" as EntryId)).toEqual({ ok: true, value: meeting });
  });

  test("saving again replaces the entry; removing forgets it", () => {
    timesheet.saveEntry(entry("e1", 0, 30));
    const changed = { ...entry("e1", 10, 40, "MOB-2") };
    timesheet.saveEntry(changed);
    expect(timesheet.entry("e1" as EntryId)).toEqual({ ok: true, value: changed });
    expect(timesheet.removeEntry("e1" as EntryId)).toEqual({ ok: true, value: undefined });
    expect(timesheet.entries(at(0), at(100))).toEqual({ ok: true, value: [] });
  });

  test("storage refuses an entry ending before it starts, on an issue and a category, or on a workspace and a group", () => {
    expect(timesheet.saveEntry({ ...entry("e1", 30, 30) }).ok).toBe(false);
    expect(
      timesheet.saveEntry({ ...entry("e1", 0, 30, "MOB-1"), category: "Meeting" as Category }).ok,
    ).toBe(false);
    expect(timesheet.saveEntry({ ...entry("e1", 0, 30), group: "Banking" as GroupName }).ok).toBe(
      false,
    );
    expect(timesheet.saveEntry({ ...entry("e1", 0, 30), workspaceId: null }).ok).toBe(false);
  });

  test("days are kept in order; one saying nothing is removed", () => {
    const leave = day("2026-09-10", { leave: true });
    const worked = day("2026-09-08", {
      place: "Head office" as WorkPlace,
      tasks: "Login: fixed.\nRelease: tagged." as DayTasks,
    });
    timesheet.saveDay(BANKING, leave, at(0));
    timesheet.saveDay(BANKING, worked, at(0));
    expect(timesheet.days(BANKING, ...SEPTEMBER)).toEqual({ ok: true, value: [worked, leave] });
    expect(
      timesheet.days(BANKING, "2026-09-09" as CalendarDay, "2026-09-10" as CalendarDay),
    ).toEqual({ ok: true, value: [leave] });
    timesheet.saveDay(BANKING, day("2026-09-10"), at(1));
    expect(
      timesheet.days(BANKING, "2026-09-10" as CalendarDay, "2026-09-10" as CalendarDay),
    ).toEqual({ ok: true, value: [] });
  });

  test("each timesheet's days are its own", () => {
    const banking = day("2026-09-10", { place: "Head office" as WorkPlace });
    const side = day("2026-09-10", { leave: true });
    timesheet.saveDay(BANKING, banking, at(0));
    timesheet.saveDay(SIDE, side, at(0));
    expect(timesheet.days(BANKING, ...SEPTEMBER)).toEqual({ ok: true, value: [banking] });
    expect(timesheet.days(SIDE, ...SEPTEMBER)).toEqual({ ok: true, value: [side] });
    timesheet.saveDay(SIDE, day("2026-09-10"), at(1));
    expect(timesheet.days(BANKING, ...SEPTEMBER)).toEqual({ ok: true, value: [banking] });
    expect(timesheet.days(SIDE, ...SEPTEMBER)).toEqual({ ok: true, value: [] });
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
    db.run("UPDATE time_entries SET workspace_id = NULL, group_name = 'a\tb'");
    expect(timesheet.entry("e1" as EntryId).ok).toBe(false);

    timesheet.saveDay(BANKING, day("2026-09-10", { leave: true }), at(0));
    db.run("UPDATE timesheet_days SET place = 'a\nb'");
    expect(timesheet.days(BANKING, ...SEPTEMBER).ok).toBe(false);
  });

  test("rows of the wrong shape are a storage error", () => {
    const fresh = migratedMemoryDatabase();
    fresh.run("DROP TABLE time_entries");
    fresh.run(
      `CREATE TABLE time_entries
       (id, workspace_id, group_name, issue_key, category, start_at, end_at, note)`,
    );
    fresh.run(
      "INSERT INTO time_entries VALUES ('e1', 'mobile', NULL, NULL, 'Meeting', 'soon', 5, NULL)",
    );
    const repository = new SqliteTimesheetRepository(fresh);
    expect(repository.entry("e1" as EntryId).ok).toBe(false);
    fresh.run("UPDATE time_entries SET start_at = 9, end_at = 5");
    expect(repository.entry("e1" as EntryId).ok).toBe(false);
    fresh.run("DROP TABLE timesheet_days");
    fresh.run("CREATE TABLE timesheet_days (scope, day, place, leave, tasks, updated_at)");
    fresh.run(
      "INSERT INTO timesheet_days VALUES ('group:Banking', '2026-09-31', NULL, 1, NULL, 0)",
    );
    expect(
      repository.days(BANKING, "2026-09-01" as CalendarDay, "2026-09-31" as CalendarDay).ok,
    ).toBe(false);
    fresh.run("UPDATE timesheet_days SET day = '2026-09-30', leave = 2");
    expect(repository.days(BANKING, ...SEPTEMBER).ok).toBe(false);
    fresh.run("UPDATE timesheet_days SET leave = 'yes'");
    expect(repository.days(BANKING, ...SEPTEMBER).ok).toBe(false);
  });

  test("a closed database reports read, save and remove failures", () => {
    db.close();
    expect(timesheet.entry("e1" as EntryId)).toMatchObject({
      ok: false,
      error: { operation: "timesheet.read" },
    });
    expect(timesheet.entries(at(0), at(1)).ok).toBe(false);
    expect(timesheet.days(BANKING, ...SEPTEMBER).ok).toBe(false);
    expect(timesheet.saveEntry(entry("e1", 0, 30))).toMatchObject({
      ok: false,
      error: { operation: "timesheet.save", message: "Unable to save the time entry" },
    });
    expect(timesheet.saveDay(BANKING, day("2026-09-01", { leave: true }), at(0))).toMatchObject({
      ok: false,
      error: { message: "Unable to save the day" },
    });
    expect(timesheet.removeEntry("e1" as EntryId)).toMatchObject({
      ok: false,
      error: { operation: "timesheet.remove" },
    });
  });
});
