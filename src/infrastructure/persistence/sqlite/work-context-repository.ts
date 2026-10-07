import type { Database } from "bun:sqlite";
import { z } from "zod";
import type { WorkContextRepository } from "../../../application/ports/work-context-repository";
import { type StorageError, storageError } from "../../../domain/shared/errors";
import { type WorkspaceId, workId, workspaceId } from "../../../domain/shared/ids";
import { err, ok, type Result } from "../../../domain/shared/result";
import { timestamp } from "../../../domain/shared/time";
import { issueKey } from "../../../domain/work/issue-key";
import { issueTitle, type WorkContext } from "../../../domain/work/work-context";

const RowSchema = z.object({
  id: z.string(),
  workspace_id: z.string(),
  issue_key: z.string(),
  title: z.string().nullable(),
  started_at: z.number(),
  ended_at: z.number().nullable(),
});

function toWork(raw: unknown): WorkContext | null {
  const row = RowSchema.safeParse(raw);
  if (!row.success) return null;
  const { data } = row;
  const id = workId(data.id);
  const workspace = workspaceId(data.workspace_id);
  const issue = issueKey(data.issue_key);
  const title = data.title === null ? ok(null) : issueTitle(data.title);
  const startedAt = timestamp(data.started_at);
  const endedAt = data.ended_at === null ? ok(null) : timestamp(data.ended_at);
  if (!id.ok || !workspace.ok || !issue.ok || !title.ok || !startedAt.ok || !endedAt.ok) {
    return null;
  }
  return Object.freeze({
    id: id.value,
    workspaceId: workspace.value,
    issueKey: issue.value,
    title: title.value,
    startedAt: startedAt.value,
    endedAt: endedAt.value,
  });
}

export class SqliteWorkContextRepository implements WorkContextRepository {
  constructor(private readonly db: Database) {}

  open(): Result<ReadonlyMap<WorkspaceId, WorkContext>, StorageError> {
    let rows: unknown[];
    try {
      rows = this.db
        .query(
          `SELECT id, workspace_id, issue_key, title, started_at, ended_at
           FROM work_contexts WHERE ended_at IS NULL`,
        )
        .all();
    } catch (thrown) {
      return err(
        storageError("Unable to read work in progress", "work_contexts.read", { cause: thrown }),
      );
    }
    const open = new Map<WorkspaceId, WorkContext>();
    for (const raw of rows) {
      const work = toWork(raw);
      if (work === null) {
        return err(storageError("A stored work context is corrupt", "work_contexts.read"));
      }
      open.set(work.workspaceId, work);
    }
    return ok(open);
  }

  save(work: WorkContext): Result<void, StorageError> {
    try {
      this.db
        .query(
          `INSERT INTO work_contexts (id, workspace_id, issue_key, title, started_at, ended_at)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT (id) DO UPDATE SET title = excluded.title, ended_at = excluded.ended_at`,
        )
        .run(work.id, work.workspaceId, work.issueKey, work.title, work.startedAt, work.endedAt);
      return ok(undefined);
    } catch (thrown) {
      return err(
        storageError("Unable to save the work context", "work_contexts.save", { cause: thrown }),
      );
    }
  }
}
