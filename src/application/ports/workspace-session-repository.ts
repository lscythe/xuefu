import type { StorageError } from "../../domain/shared/errors";
import type { WorkspaceId } from "../../domain/shared/ids";
import type { Result } from "../../domain/shared/result";
import type { Timestamp } from "../../domain/shared/time";
import type { NavigationKey } from "../../domain/workspace/session";

/** Per-workspace cockpit state that survives restarts; rows go away with their workspace. */
export interface WorkspaceSessionRepository {
  navigation(): Result<ReadonlyMap<WorkspaceId, NavigationKey>, StorageError>;
  saveNavigation(
    id: WorkspaceId,
    navigation: NavigationKey,
    at: Timestamp,
  ): Result<void, StorageError>;
}
