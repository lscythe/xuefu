import type { FileSystemError, StorageError } from "../../domain/shared/errors";
import type { AbsolutePath } from "../../domain/shared/path";
import { ok, type Result } from "../../domain/shared/result";
import { lastActiveWorkspace, workspaceAt } from "../../domain/workspace/registry";
import type { Workspace } from "../../domain/workspace/workspace";
import type { WorkspaceCapabilities, WorkspaceProbe } from "../ports/workspace-probe";
import type { WorkspaceRepository } from "../ports/workspace-repository";

/** "missing" covers folders that were deleted, moved or became unreadable since registration. */
type WorkspaceStatus = "ready" | "missing";

export interface WorkspaceView {
  readonly workspace: Workspace;
  readonly status: WorkspaceStatus;
  readonly capabilities: WorkspaceCapabilities;
}

const NO_CAPABILITIES: WorkspaceCapabilities = Object.freeze({ git: false, gradle: false });

/** The workspace registry's read side; reads never go through the command bus. */
export class WorkspaceQueries {
  constructor(
    private readonly repository: WorkspaceRepository,
    private readonly probe: WorkspaceProbe,
  ) {}

  async list(): Promise<Result<WorkspaceView[], StorageError>> {
    const loaded = this.repository.load();
    if (!loaded.ok) return loaded;
    const views = await Promise.all(
      loaded.value.workspaces.map(async (workspace): Promise<WorkspaceView> => {
        const probed = await this.probe.probe(workspace.path);
        return probed.ok
          ? { workspace, status: "ready", capabilities: probed.value.capabilities }
          : { workspace, status: "missing", capabilities: NO_CAPABILITIES };
      }),
    );
    return ok(views);
  }

  /** The workspace opened most recently, or null when none has been opened yet. */
  lastActive(): Result<Workspace | null, StorageError> {
    const loaded = this.repository.load();
    return loaded.ok ? ok(lastActiveWorkspace(loaded.value)) : loaded;
  }

  /** The workspace containing `path` (symlinks resolved), or null when it is in none. */
  async which(
    path: AbsolutePath,
  ): Promise<Result<Workspace | null, StorageError | FileSystemError>> {
    const probed = await this.probe.probe(path);
    if (!probed.ok) return probed;
    const loaded = this.repository.load();
    if (!loaded.ok) return loaded;
    return ok(workspaceAt(loaded.value, probed.value.path));
  }
}
