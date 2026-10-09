import type { Note } from "../../domain/notes/note";
import type { NotFoundError, StorageError } from "../../domain/shared/errors";
import type { WorkspaceId } from "../../domain/shared/ids";
import { ok, type Result } from "../../domain/shared/result";
import type { IssueKey } from "../../domain/work/issue-key";
import { findWorkspace } from "../../domain/workspace/registry";
import type { Workspace } from "../../domain/workspace/workspace";
import type { NoteRepository } from "../ports/note-repository";
import type { WorkspaceRepository } from "../ports/workspace-repository";

/** A note with the workspace it belongs to; null once that workspace has been removed. */
export interface NoteView {
  readonly note: Note;
  readonly workspace: Workspace | null;
}

/** A registered workspace and its note on one subject, if it has one. */
export interface FoundNote {
  readonly note: Note | null;
  readonly workspace: Workspace;
}

export class NoteQueries {
  constructor(
    private readonly notes: NoteRepository,
    private readonly workspaces: WorkspaceRepository,
  ) {}

  /** The note on `issue` in the workspace, or the workspace's own note when `issue` is null. */
  find(
    workspace: WorkspaceId,
    issue: IssueKey | null,
  ): Result<FoundNote, NotFoundError | StorageError> {
    const registry = this.workspaces.load();
    if (!registry.ok) return registry;
    const found = findWorkspace(registry.value, workspace);
    if (!found.ok) return found;
    const note = this.notes.find(workspace, issue);
    return note.ok ? ok({ note: note.value, workspace: found.value }) : note;
  }

  /** Every note, the latest change first. */
  list(): Result<readonly NoteView[], StorageError> {
    const all = this.notes.all();
    if (!all.ok) return all;
    const registry = this.workspaces.load();
    if (!registry.ok) return registry;
    const byId = new Map(registry.value.workspaces.map((w) => [w.id, w]));
    return ok(all.value.map((note) => ({ note, workspace: byId.get(note.workspaceId) ?? null })));
  }
}
