import type { Brand } from "../shared/brand";
import { type ValidationError, validationError } from "../shared/errors";
import type { NoteId, WorkspaceId } from "../shared/ids";
import { err, ok, type Result } from "../shared/result";
import type { Timestamp } from "../shared/time";
import type { IssueKey } from "../work/issue-key";

/** A note's text: plain lines, never blank. */
export type NoteBody = Brand<string, "NoteBody">;

const MAX_NOTE = 20_000;
// Control characters other than tab and newline, which a note's lines are made of.
const CONTROL_CHARACTER = /[^\P{Cc}\t\n]/u;

/**
 * Accepts note text as typed or pasted: line endings are made plain, and blank lines before and
 * whitespace after the text are dropped. Blank text is null: no note.
 */
export function noteBody(raw: string): Result<NoteBody | null, ValidationError> {
  const value = raw
    .replace(/\r\n?/g, "\n")
    .replace(/^(?:[ \t]*\n)+/, "")
    .trimEnd();
  if (value === "") return ok(null);
  const problem =
    value.length > MAX_NOTE
      ? `must be at most ${MAX_NOTE} characters`
      : CONTROL_CHARACTER.test(value)
        ? "must not contain control characters other than tabs"
        : null;
  if (problem !== null) {
    return err(validationError("Note is invalid", [{ path: "body", message: problem }]));
  }
  return ok(value as NoteBody);
}

/** Adds `addition` to the note on a line of its own. */
export function appendToNote(
  body: NoteBody | null,
  addition: NoteBody,
): Result<NoteBody, ValidationError> {
  if (body === null) return ok(addition);
  const joined = noteBody(`${body}\n${addition}`);
  return joined.ok ? ok(joined.value ?? addition) : joined;
}

/**
 * What to remember about a workspace, or about one issue worked on there. Each workspace has at
 * most one note of its own and one per issue.
 */
export interface Note {
  readonly id: NoteId;
  readonly workspaceId: WorkspaceId;
  /** Null for the workspace's own note. */
  readonly issueKey: IssueKey | null;
  readonly body: NoteBody;
  readonly updatedAt: Timestamp;
}
