import type { StorageError } from "../../domain/shared/errors";
import type { WorkspaceId } from "../../domain/shared/ids";
import type { Result } from "../../domain/shared/result";

/**
 * The open tabs, in order. Which one is in front is not stored here: it is the open workspace
 * activated most recently, so it cannot disagree with the registry.
 */
export interface WorkspaceTabsRepository {
  load(): Result<readonly WorkspaceId[], StorageError>;
  save(open: readonly WorkspaceId[]): Result<void, StorageError>;
}
