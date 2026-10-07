import type { StorageError } from "../../domain/shared/errors";
import { ok, type Result } from "../../domain/shared/result";
import type { WorkContext } from "../../domain/work/work-context";
import type { WorkspaceRegistry } from "../../domain/workspace/registry";
import type { Workspace } from "../../domain/workspace/workspace";
import type { WorkContextRepository } from "../ports/work-context-repository";
import type { WorkspaceRepository } from "../ports/workspace-repository";

/** Work with the workspace it belongs to; null once that workspace has been removed. */
export interface WorkView {
  readonly work: WorkContext;
  readonly workspace: Workspace | null;
}

export function viewWork(registry: WorkspaceRegistry, work: WorkContext): WorkView {
  return {
    work,
    workspace: registry.workspaces.find((w) => w.id === work.workspaceId) ?? null,
  };
}

export class WorkQueries {
  constructor(
    private readonly contexts: WorkContextRepository,
    private readonly workspaces: WorkspaceRepository,
  ) {}

  /** Work in progress in every workspace, oldest first. */
  inProgress(): Result<readonly WorkView[], StorageError> {
    const open = this.contexts.open();
    if (!open.ok) return open;
    const loaded = this.workspaces.load();
    if (!loaded.ok) return loaded;
    const registry = loaded.value;
    return ok(
      [...open.value.values()]
        .sort((a, b) => a.startedAt - b.startedAt)
        .map((work) => viewWork(registry, work)),
    );
  }
}
