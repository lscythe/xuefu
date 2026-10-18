import type { Brand } from "../shared/brand";
import { type ValidationError, validationError } from "../shared/errors";
import type { EntryId, WorkspaceId } from "../shared/ids";
import { err, ok, type Result } from "../shared/result";
import type { Timestamp } from "../shared/time";
import type { IssueKey } from "../work/issue-key";
import type { GroupName } from "../workspace/workspace";

/** What time not on an issue went to, such as "Meeting" or "Review". */
export type Category = Brand<string, "Category">;

/** What was done in a stretch of time, for the timesheet. */
export type EntryNote = Brand<string, "EntryNote">;

const MAX_CATEGORY = 40;
const MAX_NOTE = 2000;
// Control characters, tabs and newlines included: a category and a note are each one line.
const CONTROL_CHARACTER = /\p{Cc}/u;

const invalid = (path: string, message: string) =>
  err(validationError(`${path === "note" ? "Note" : "Category"} is invalid`, [{ path, message }]));

export function category(raw: string): Result<Category, ValidationError> {
  const value = raw.trim();
  if (value === "") return invalid("category", "must not be blank");
  if (value.length > MAX_CATEGORY) {
    return invalid("category", `must be at most ${MAX_CATEGORY} characters`);
  }
  if (CONTROL_CHARACTER.test(value)) return invalid("category", "must be one line");
  return ok(value as Category);
}

/** A note as typed: trimmed; blank is null, no note. */
export function entryNote(raw: string): Result<EntryNote | null, ValidationError> {
  const value = raw.trim();
  if (value === "") return ok(null);
  if (value.length > MAX_NOTE) return invalid("note", `must be at most ${MAX_NOTE} characters`);
  if (CONTROL_CHARACTER.test(value)) return invalid("note", "must be one line");
  return ok(value as EntryNote);
}

/**
 * Time added by hand, for what no timer ran: a meeting, or work done away from the desk. It is on
 * an issue, or in a category, never both. It belongs to a group, such as a meeting for all its
 * workspaces, or to one workspace, and then to whichever group that workspace is in.
 */
export interface TimeEntry {
  readonly id: EntryId;
  readonly workspaceId: WorkspaceId | null;
  /** Set only when the entry is on no one workspace. */
  readonly group: GroupName | null;
  readonly issueKey: IssueKey | null;
  readonly category: Category | null;
  readonly start: Timestamp;
  readonly end: Timestamp;
  readonly note: EntryNote | null;
}

const HOUR = 3_600_000;
/** Longer than any day's work; stops a mistyped date making a week-long entry. */
const MAX_LENGTH = 24 * HOUR;

/** Checks an entry's fields hang together, then freezes it. */
export function timeEntry(fields: TimeEntry): Result<TimeEntry, ValidationError> {
  const problem =
    fields.end <= fields.start
      ? { path: "to", message: "must be after the start" }
      : fields.end - fields.start > MAX_LENGTH
        ? { path: "to", message: "must be within a day of the start" }
        : (fields.issueKey === null) === (fields.category === null)
          ? { path: "category", message: "give an issue or a category, one of them" }
          : (fields.workspaceId === null) === (fields.group === null)
            ? { path: "group", message: "give a workspace or a group, one of them" }
            : null;
  if (problem !== null) return err(validationError("Time entry is invalid", [problem]));
  return ok(Object.freeze({ ...fields }));
}
