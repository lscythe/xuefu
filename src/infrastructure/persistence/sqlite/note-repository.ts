import type { Database } from "bun:sqlite";
import { z } from "zod";
import type { NoteRepository } from "../../../application/ports/note-repository";
import { type Note, noteBody } from "../../../domain/notes/note";
import { type StorageError, storageError } from "../../../domain/shared/errors";
import { type NoteId, noteId, type WorkspaceId, workspaceId } from "../../../domain/shared/ids";
import { err, ok, type Result } from "../../../domain/shared/result";
import { timestamp } from "../../../domain/shared/time";
import { type IssueKey, issueKey } from "../../../domain/work/issue-key";

const RowSchema = z.object({
  id: z.string(),
  workspace_id: z.string(),
  issue_key: z.string().nullable(),
  body: z.string(),
  updated_at: z.number(),
});

const COLUMNS = "id, workspace_id, issue_key, body, updated_at";

function toNote(raw: unknown): Note | null {
  const row = RowSchema.safeParse(raw);
  if (!row.success) return null;
  const { data } = row;
  const id = noteId(data.id);
  const workspace = workspaceId(data.workspace_id);
  const issue = data.issue_key === null ? ok(null) : issueKey(data.issue_key);
  const body = noteBody(data.body);
  const updatedAt = timestamp(data.updated_at);
  if (!id.ok || !workspace.ok || !issue.ok || !body.ok || body.value === null || !updatedAt.ok) {
    return null;
  }
  return Object.freeze({
    id: id.value,
    workspaceId: workspace.value,
    issueKey: issue.value,
    body: body.value,
    updatedAt: updatedAt.value,
  });
}

const corrupt = () => err(storageError("A stored note is corrupt", "notes.read"));
const unreadable = (thrown: unknown) =>
  err(storageError("Unable to read notes", "notes.read", { cause: thrown }));

export class SqliteNoteRepository implements NoteRepository {
  constructor(private readonly db: Database) {}

  find(workspace: WorkspaceId, issue: IssueKey | null): Result<Note | null, StorageError> {
    let row: unknown;
    try {
      row = this.db
        .query(
          `SELECT ${COLUMNS} FROM notes
           WHERE workspace_id = ? AND coalesce(issue_key, '') = coalesce(?, '')`,
        )
        .get(workspace, issue);
    } catch (thrown) {
      return unreadable(thrown);
    }
    if (row === null) return ok(null);
    const note = toNote(row);
    return note === null ? corrupt() : ok(note);
  }

  all(): Result<readonly Note[], StorageError> {
    let rows: unknown[];
    try {
      rows = this.db.query(`SELECT ${COLUMNS} FROM notes ORDER BY updated_at DESC, id`).all();
    } catch (thrown) {
      return unreadable(thrown);
    }
    const all: Note[] = [];
    for (const raw of rows) {
      const note = toNote(raw);
      if (note === null) return corrupt();
      all.push(note);
    }
    return ok(all);
  }

  save(note: Note): Result<void, StorageError> {
    try {
      this.db
        .query(
          `INSERT INTO notes (${COLUMNS}) VALUES (?, ?, ?, ?, ?)
           ON CONFLICT (id) DO UPDATE SET body = excluded.body, updated_at = excluded.updated_at`,
        )
        .run(note.id, note.workspaceId, note.issueKey, note.body, note.updatedAt);
      return ok(undefined);
    } catch (thrown) {
      return err(storageError("Unable to save the note", "notes.save", { cause: thrown }));
    }
  }

  remove(id: NoteId): Result<void, StorageError> {
    try {
      this.db.query("DELETE FROM notes WHERE id = ?").run(id);
      return ok(undefined);
    } catch (thrown) {
      return err(storageError("Unable to remove the note", "notes.remove", { cause: thrown }));
    }
  }
}
