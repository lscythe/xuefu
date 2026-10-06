import type { StorageError } from "../../domain/shared/errors";
import type { Result } from "../../domain/shared/result";
import type { WorkspaceRegistry } from "../../domain/workspace/registry";

/**
 * Durable workspace registry. Synchronous so it can run inside a unit of work; the registry is
 * small, so it is loaded and saved as a whole and the domain enforces its invariants.
 */
export interface WorkspaceRepository {
  load(): Result<WorkspaceRegistry, StorageError>;
  save(registry: WorkspaceRegistry): Result<void, StorageError>;
}
