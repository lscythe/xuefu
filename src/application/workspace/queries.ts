import type { FileSystemError, NotFoundError, StorageError } from "../../domain/shared/errors";
import type { WorkspaceId } from "../../domain/shared/ids";
import type { AbsolutePath } from "../../domain/shared/path";
import { ok, type Result } from "../../domain/shared/result";
import {
  findWorkspace,
  type WorkspaceRegistry,
  workspaceAt,
} from "../../domain/workspace/registry";
import type { NavigationKey } from "../../domain/workspace/session";
import { currentTabs, type WorkspaceTabs } from "../../domain/workspace/tabs";
import type { Workspace } from "../../domain/workspace/workspace";
import type { WorkspaceCapabilities, WorkspaceProbe } from "../ports/workspace-probe";
import type { WorkspaceRepository } from "../ports/workspace-repository";
import type { WorkspaceSessionRepository } from "../ports/workspace-session-repository";
import type { WorkspaceTabsRepository } from "../ports/workspace-tabs-repository";

/** "missing" covers folders that were deleted, moved or became unreadable since registration. */
type WorkspaceStatus = "ready" | "missing";

export interface WorkspaceView {
  readonly workspace: Workspace;
  readonly status: WorkspaceStatus;
  readonly capabilities: WorkspaceCapabilities;
}

/** Open tabs as the cockpit shows them: whole workspaces, in order, and the one in front. */
export interface OpenTabs {
  readonly open: readonly Workspace[];
  readonly active: Workspace | null;
}

export function viewTabs(registry: WorkspaceRegistry, tabs: WorkspaceTabs): OpenTabs {
  const byId = new Map(registry.workspaces.map((w) => [w.id, w]));
  const open = tabs.open.flatMap((id) => byId.get(id) ?? []);
  return { open, active: tabs.active === null ? null : (byId.get(tabs.active) ?? null) };
}

const NO_CAPABILITIES: WorkspaceCapabilities = Object.freeze({ git: false, gradle: false });

/** The workspace registry's read side; reads never go through the command bus. */
export class WorkspaceQueries {
  constructor(
    private readonly repository: WorkspaceRepository,
    private readonly probe: WorkspaceProbe,
    private readonly tabRepository: WorkspaceTabsRepository,
    private readonly sessions: WorkspaceSessionRepository,
  ) {}

  /** The registered workspace with this id. */
  find(id: WorkspaceId): Result<Workspace, NotFoundError | StorageError> {
    const registry = this.repository.load();
    return registry.ok ? findWorkspace(registry.value, id) : registry;
  }

  /** Where each workspace was left in the cockpit, keyed by workspace. */
  navigation(): Result<ReadonlyMap<WorkspaceId, NavigationKey>, StorageError> {
    return this.sessions.navigation();
  }

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

  /** The open tabs; the front one is the open workspace activated most recently. */
  tabs(): Result<OpenTabs, StorageError> {
    const loaded = this.repository.load();
    if (!loaded.ok) return loaded;
    const stored = this.tabRepository.load();
    if (!stored.ok) return stored;
    return ok(viewTabs(loaded.value, currentTabs(loaded.value, stored.value)));
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
