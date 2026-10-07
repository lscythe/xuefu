import type { StorageError } from "../../domain/shared/errors";
import type { WorkspaceId } from "../../domain/shared/ids";
import type { Result } from "../../domain/shared/result";
import type { WorkContext } from "../../domain/work/work-context";

/** Work contexts; storage keeps at most one open per workspace, and finished ones are kept. */
export interface WorkContextRepository {
  /** Work in progress, at most one per workspace. */
  open(): Result<ReadonlyMap<WorkspaceId, WorkContext>, StorageError>;
  /** Inserts or replaces the context. */
  save(work: WorkContext): Result<void, StorageError>;
}
