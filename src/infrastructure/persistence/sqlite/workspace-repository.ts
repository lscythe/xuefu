import type { Database } from "bun:sqlite";
import { z } from "zod";
import type { WorkspaceRepository } from "../../../application/ports/workspace-repository";
import { type StorageError, storageError } from "../../../domain/shared/errors";
import { workspaceId } from "../../../domain/shared/ids";
import { absolutePath } from "../../../domain/shared/path";
import { err, ok, type Result } from "../../../domain/shared/result";
import { timestamp } from "../../../domain/shared/time";
import { createRegistry, type WorkspaceRegistry } from "../../../domain/workspace/registry";
import { groupName, type Workspace, workspaceName } from "../../../domain/workspace/workspace";

const RowSchema = z.object({
  id: z.string(),
  name: z.string(),
  path: z.string(),
  group_name: z.string().nullable(),
  added_at: z.int(),
});

function corrupt(id: unknown): StorageError {
  return storageError(`Workspace row ${String(id)} is corrupt`, "workspaces.read", {
    context: { id: typeof id === "string" ? id : null },
  });
}

function decodeRow(raw: unknown): Result<Workspace, StorageError> {
  const parsed = RowSchema.safeParse(raw);
  if (!parsed.success) return err(corrupt((raw as { id?: unknown } | null)?.id));
  const row = parsed.data;
  const id = workspaceId(row.id);
  const name = workspaceName(row.name);
  const path = absolutePath(row.path);
  const group = row.group_name === null ? ok(null) : groupName(row.group_name);
  const addedAt = timestamp(row.added_at);
  // A stored name must already be in canonical (trimmed) form.
  if (!id.ok || !name.ok || name.value !== row.name || !path.ok || !group.ok || !addedAt.ok) {
    return err(corrupt(row.id));
  }
  return ok({
    id: id.value,
    name: name.value,
    path: path.value,
    group: group.value,
    addedAt: addedAt.value,
  });
}

export class SqliteWorkspaceRepository implements WorkspaceRepository {
  constructor(private readonly db: Database) {}

  load(): Result<WorkspaceRegistry, StorageError> {
    let rows: unknown[];
    try {
      rows = this.db.query("SELECT * FROM workspaces ORDER BY position, id").all();
    } catch (thrown) {
      return err(storageError("Unable to read workspaces", "workspaces.read", { cause: thrown }));
    }
    const workspaces: Workspace[] = [];
    for (const raw of rows) {
      const decoded = decodeRow(raw);
      if (!decoded.ok) return decoded;
      workspaces.push(decoded.value);
    }
    const registry = createRegistry(workspaces);
    if (!registry.ok) {
      return err(
        storageError("Stored workspaces are inconsistent", "workspaces.read", {
          context: { key: registry.error.key },
        }),
      );
    }
    return registry;
  }

  save(registry: WorkspaceRegistry): Result<void, StorageError> {
    try {
      // Uses a savepoint inside a unit of work, so the outer rollback still applies.
      this.db.transaction(() => {
        // Delete first so a path freed by a removal can be reused in the same save.
        this.db
          .query("DELETE FROM workspaces WHERE id NOT IN (SELECT value FROM json_each(?))")
          .run(JSON.stringify(registry.workspaces.map((w) => w.id)));
        const upsert = this.db.query(
          `INSERT INTO workspaces (id, name, path, group_name, position, added_at)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT (id) DO UPDATE SET
             name = excluded.name, path = excluded.path, group_name = excluded.group_name,
             position = excluded.position, added_at = excluded.added_at`,
        );
        registry.workspaces.forEach((w, position) => {
          upsert.run(w.id, w.name, w.path, w.group, position, w.addedAt);
        });
      })();
      return ok(undefined);
    } catch (thrown) {
      return err(storageError("Unable to save workspaces", "workspaces.save", { cause: thrown }));
    }
  }
}
