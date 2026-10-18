import type { Database } from "bun:sqlite";
import { z } from "zod";
import type { TimesheetRepository } from "../../../application/ports/timesheet-repository";
import { type CalendarDay, calendarDay } from "../../../domain/shared/calendar";
import { type StorageError, storageError } from "../../../domain/shared/errors";
import { type EntryId, entryId, workspaceId } from "../../../domain/shared/ids";
import { err, ok, type Result } from "../../../domain/shared/result";
import { type Timestamp, timestamp } from "../../../domain/shared/time";
import { dayTasks, isEmptyDay, type TimesheetDay, workPlace } from "../../../domain/timesheet/day";
import { category, entryNote, type TimeEntry, timeEntry } from "../../../domain/timesheet/entry";
import { issueKey } from "../../../domain/work/issue-key";

const EntryRowSchema = z.object({
  id: z.string(),
  workspace_id: z.string(),
  issue_key: z.string().nullable(),
  category: z.string().nullable(),
  start_at: z.number(),
  end_at: z.number(),
  note: z.string().nullable(),
});

const DayRowSchema = z.object({
  day: z.string(),
  place: z.string().nullable(),
  leave: z.number(),
  tasks: z.string().nullable(),
});

const ENTRY_COLUMNS = "id, workspace_id, issue_key, category, start_at, end_at, note";

/** A stored value read back through its own rules; null when they refuse it. */
const read = <T>(raw: string | null, parse: (raw: string) => Result<T, unknown>): T | null => {
  if (raw === null) return null;
  const parsed = parse(raw);
  return parsed.ok ? parsed.value : null;
};

function toEntry(raw: unknown): TimeEntry | null {
  const row = EntryRowSchema.safeParse(raw);
  if (!row.success) return null;
  const { data } = row;
  const id = entryId(data.id);
  const workspace = workspaceId(data.workspace_id);
  const start = timestamp(data.start_at);
  const end = timestamp(data.end_at);
  const issue = read(data.issue_key, issueKey);
  const kind = read(data.category, category);
  const note = data.note === null ? ok(null) : entryNote(data.note);
  if (!id.ok || !workspace.ok || !start.ok || !end.ok || !note.ok) return null;
  if ((data.issue_key !== null && issue === null) || (data.category !== null && kind === null)) {
    return null;
  }
  const entry = timeEntry({
    id: id.value,
    workspaceId: workspace.value,
    issueKey: issue,
    category: kind,
    start: start.value,
    end: end.value,
    note: note.value,
  });
  return entry.ok ? entry.value : null;
}

function toDay(raw: unknown): TimesheetDay | null {
  const row = DayRowSchema.safeParse(raw);
  if (!row.success) return null;
  const { data } = row;
  const day = calendarDay(data.day);
  const place = data.place === null ? ok(null) : workPlace(data.place);
  const tasks = data.tasks === null ? ok(null) : dayTasks(data.tasks);
  if (!day.ok || !place.ok || !tasks.ok || (data.leave !== 0 && data.leave !== 1)) return null;
  return Object.freeze({
    day: day.value,
    place: place.value,
    leave: data.leave === 1,
    tasks: tasks.value,
  });
}

const corrupt = () => err(storageError("Stored timesheet data is corrupt", "timesheet.read"));
const unreadable = (thrown: unknown) =>
  err(storageError("Unable to read the timesheet", "timesheet.read", { cause: thrown }));
const unsaved = (what: string, thrown: unknown) =>
  err(storageError(`Unable to save the ${what}`, "timesheet.save", { cause: thrown }));

/** Every row read through `to`; a corrupt one fails the whole read. */
function all<T>(
  rows: readonly unknown[],
  to: (raw: unknown) => T | null,
): Result<T[], StorageError> {
  const read: T[] = [];
  for (const raw of rows) {
    const value = to(raw);
    if (value === null) return corrupt();
    read.push(value);
  }
  return ok(read);
}

export class SqliteTimesheetRepository implements TimesheetRepository {
  constructor(private readonly db: Database) {}

  entry(id: EntryId): Result<TimeEntry | null, StorageError> {
    let row: unknown;
    try {
      row = this.db.query(`SELECT ${ENTRY_COLUMNS} FROM time_entries WHERE id = ?`).get(id);
    } catch (thrown) {
      return unreadable(thrown);
    }
    if (row === null) return ok(null);
    const entry = toEntry(row);
    return entry === null ? corrupt() : ok(entry);
  }

  entries(from: Timestamp, to: Timestamp): Result<TimeEntry[], StorageError> {
    let rows: unknown[];
    try {
      rows = this.db
        .query(
          `SELECT ${ENTRY_COLUMNS} FROM time_entries
           WHERE start_at < ? AND end_at > ? ORDER BY start_at, id`,
        )
        .all(to, from);
    } catch (thrown) {
      return unreadable(thrown);
    }
    return all(rows, toEntry);
  }

  saveEntry(entry: TimeEntry): Result<void, StorageError> {
    try {
      this.db
        .query(
          `INSERT INTO time_entries (${ENTRY_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT (id) DO UPDATE SET
             workspace_id = excluded.workspace_id,
             issue_key = excluded.issue_key,
             category = excluded.category,
             start_at = excluded.start_at,
             end_at = excluded.end_at,
             note = excluded.note`,
        )
        .run(
          entry.id,
          entry.workspaceId,
          entry.issueKey,
          entry.category,
          entry.start,
          entry.end,
          entry.note,
        );
      return ok(undefined);
    } catch (thrown) {
      return unsaved("time entry", thrown);
    }
  }

  removeEntry(id: EntryId): Result<void, StorageError> {
    try {
      this.db.query("DELETE FROM time_entries WHERE id = ?").run(id);
      return ok(undefined);
    } catch (thrown) {
      return err(
        storageError("Unable to delete the time entry", "timesheet.remove", { cause: thrown }),
      );
    }
  }

  days(from: CalendarDay, to: CalendarDay): Result<TimesheetDay[], StorageError> {
    let rows: unknown[];
    try {
      rows = this.db
        .query(
          "SELECT day, place, leave, tasks FROM timesheet_days WHERE day BETWEEN ? AND ? ORDER BY day",
        )
        .all(from, to);
    } catch (thrown) {
      return unreadable(thrown);
    }
    return all(rows, toDay);
  }

  saveDay(day: TimesheetDay, at: Timestamp): Result<void, StorageError> {
    try {
      if (isEmptyDay(day)) {
        this.db.query("DELETE FROM timesheet_days WHERE day = ?").run(day.day);
      } else {
        this.db
          .query(
            `INSERT INTO timesheet_days (day, place, leave, tasks, updated_at) VALUES (?, ?, ?, ?, ?)
             ON CONFLICT (day) DO UPDATE SET
               place = excluded.place,
               leave = excluded.leave,
               tasks = excluded.tasks,
               updated_at = excluded.updated_at`,
          )
          .run(day.day, day.place, day.leave ? 1 : 0, day.tasks, at);
      }
      return ok(undefined);
    } catch (thrown) {
      return unsaved("day", thrown);
    }
  }
}
