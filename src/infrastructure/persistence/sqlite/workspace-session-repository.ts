import type { Database } from "bun:sqlite";
import { z } from "zod";
import type { WorkspaceSessionRepository } from "../../../application/ports/workspace-session-repository";
import { type StorageError, storageError } from "../../../domain/shared/errors";
import { type WorkspaceId, workspaceId } from "../../../domain/shared/ids";
import { err, ok, type Result } from "../../../domain/shared/result";
import type { Timestamp } from "../../../domain/shared/time";
import { type NavigationKey, navigationKey } from "../../../domain/workspace/session";

const RowSchema = z.object({ workspace_id: z.string(), navigation: z.string() });

export class SqliteWorkspaceSessionRepository implements WorkspaceSessionRepository {
  constructor(private readonly db: Database) {}

  navigation(): Result<ReadonlyMap<WorkspaceId, NavigationKey>, StorageError> {
    let rows: unknown[];
    try {
      rows = this.db.query("SELECT workspace_id, navigation FROM workspace_sessions").all();
    } catch (thrown) {
      return err(
        storageError("Unable to read workspace sessions", "workspace_sessions.read", {
          cause: thrown,
        }),
      );
    }
    const navigation = new Map<WorkspaceId, NavigationKey>();
    for (const raw of rows) {
      const row = RowSchema.safeParse(raw);
      const id = row.success ? workspaceId(row.data.workspace_id) : null;
      const key = row.success ? navigationKey(row.data.navigation) : null;
      if (id === null || key === null || !id.ok || !key.ok) {
        return err(storageError("A workspace session is corrupt", "workspace_sessions.read"));
      }
      navigation.set(id.value, key.value);
    }
    return ok(navigation);
  }

  saveNavigation(
    id: WorkspaceId,
    navigation: NavigationKey,
    at: Timestamp,
  ): Result<void, StorageError> {
    try {
      this.db
        .query(
          `INSERT INTO workspace_sessions (workspace_id, navigation, updated_at) VALUES (?, ?, ?)
           ON CONFLICT (workspace_id) DO UPDATE SET
             navigation = excluded.navigation, updated_at = excluded.updated_at`,
        )
        .run(id, navigation, at);
      return ok(undefined);
    } catch (thrown) {
      return err(
        storageError("Unable to save the workspace session", "workspace_sessions.save", {
          cause: thrown,
        }),
      );
    }
  }
}
