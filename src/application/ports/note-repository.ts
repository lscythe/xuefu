import type { Note } from "../../domain/notes/note";
import type { StorageError } from "../../domain/shared/errors";
import type { NoteId, WorkspaceId } from "../../domain/shared/ids";
import type { Result } from "../../domain/shared/result";
import type { IssueKey } from "../../domain/work/issue-key";

/** Notes; storage keeps at most one per workspace and issue. */
export interface NoteRepository {
  /** The note on `issue` in the workspace, or the workspace's own note when `issue` is null. */
  find(workspace: WorkspaceId, issue: IssueKey | null): Result<Note | null, StorageError>;
  /** Every note, the latest change first. */
  all(): Result<readonly Note[], StorageError>;
  /** Inserts or replaces the note. */
  save(note: Note): Result<void, StorageError>;
  remove(id: NoteId): Result<void, StorageError>;
}
