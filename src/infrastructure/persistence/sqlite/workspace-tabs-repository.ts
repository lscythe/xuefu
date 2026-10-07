import type { Database } from "bun:sqlite";
import { z } from "zod";
import type { WorkspaceTabsRepository } from "../../../application/ports/workspace-tabs-repository";
import { type StorageError, storageError } from "../../../domain/shared/errors";
import { type WorkspaceId, workspaceId } from "../../../domain/shared/ids";
import { err, ok, type Result } from "../../../domain/shared/result";

const RowSchema = z.object({ workspace_id: z.string() });

export class SqliteWorkspaceTabsRepository implements WorkspaceTabsRepository {
  constructor(private readonly db: Database) {}

  load(): Result<readonly WorkspaceId[], StorageError> {
    let rows: unknown[];
    try {
      rows = this.db.query("SELECT workspace_id FROM workspace_tabs ORDER BY position").all();
    } catch (thrown) {
      return err(
        storageError("Unable to read open tabs", "workspace_tabs.read", { cause: thrown }),
      );
    }
    const open: WorkspaceId[] = [];
    for (const raw of rows) {
      const row = RowSchema.safeParse(raw);
      const id = row.success ? workspaceId(row.data.workspace_id) : null;
      if (id === null || !id.ok) {
        return err(storageError("An open tab is corrupt", "workspace_tabs.read"));
      }
      open.push(id.value);
    }
    return ok(open);
  }

  save(open: readonly WorkspaceId[]): Result<void, StorageError> {
    try {
      // A savepoint inside a unit of work, so the outer rollback still applies.
      this.db.transaction(() => {
        this.db.run("DELETE FROM workspace_tabs");
        const insert = this.db.query(
          "INSERT INTO workspace_tabs (workspace_id, position) VALUES (?, ?)",
        );
        open.forEach((id, position) => {
          insert.run(id, position);
        });
      })();
      return ok(undefined);
    } catch (thrown) {
      return err(
        storageError("Unable to save open tabs", "workspace_tabs.save", { cause: thrown }),
      );
    }
  }
}
