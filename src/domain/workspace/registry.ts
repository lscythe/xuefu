import { type ConflictError, conflict, type NotFoundError, notFound } from "../shared/errors";
import type { WorkspaceId } from "../shared/ids";
import { type AbsolutePath, baseName, isSameOrWithin } from "../shared/path";
import { err, ok, type Result } from "../shared/result";
import type { Timestamp } from "../shared/time";
import {
  type GroupName,
  suggestWorkspaceId,
  type Workspace,
  type WorkspaceName,
} from "./workspace";

/**
 * Every registered workspace, in display order. Invariants: ids are unique and paths are unique.
 * Paths may nest (a monorepo and one of its apps); the deepest match wins in `workspaceAt`.
 */
export interface WorkspaceRegistry {
  readonly workspaces: readonly Workspace[];
}

export interface NewWorkspace {
  readonly name: WorkspaceName;
  readonly path: AbsolutePath;
  readonly group: GroupName | null;
  /** Derived from the name (then the folder name) when omitted. */
  readonly id?: WorkspaceId;
}

export interface RegistryChange {
  readonly registry: WorkspaceRegistry;
  readonly workspace: Workspace;
}

const ENTITY = "workspace";
const MAX_ID_LENGTH = 64;
const FALLBACK_ID = "workspace";

function freeze(workspaces: readonly Workspace[]): WorkspaceRegistry {
  return Object.freeze({ workspaces: Object.freeze([...workspaces]) });
}

export const EMPTY_REGISTRY: WorkspaceRegistry = freeze([]);

/** Rebuilds a registry from stored rows, refusing data that breaks the invariants. */
export function createRegistry(
  workspaces: readonly Workspace[],
): Result<WorkspaceRegistry, ConflictError> {
  const ids = new Set<string>();
  const paths = new Set<string>();
  for (const workspace of workspaces) {
    if (ids.has(workspace.id)) {
      return err(conflict(`Duplicate workspace id ${workspace.id}`, ENTITY, workspace.id));
    }
    if (paths.has(workspace.path)) {
      return err(conflict(`Duplicate workspace path ${workspace.path}`, ENTITY, workspace.path));
    }
    ids.add(workspace.id);
    paths.add(workspace.path);
  }
  return ok(freeze(workspaces.map((w) => Object.freeze({ ...w }))));
}

function withSuffix(base: string, n: number): string {
  const suffix = `-${n}`;
  return `${base.slice(0, MAX_ID_LENGTH - suffix.length).replace(/-+$/, "")}${suffix}`;
}

function deriveId(registry: WorkspaceRegistry, input: NewWorkspace): WorkspaceId {
  const taken = new Set<string>(registry.workspaces.map((w) => w.id));
  const base =
    suggestWorkspaceId(input.name) ?? suggestWorkspaceId(baseName(input.path)) ?? FALLBACK_ID;
  let candidate = base;
  for (let n = 2; taken.has(candidate); n += 1) candidate = withSuffix(base, n);
  // suggestWorkspaceId only yields valid ids and suffixing keeps them valid (property-tested).
  return candidate as WorkspaceId;
}

export function addWorkspace(
  registry: WorkspaceRegistry,
  input: NewWorkspace,
  addedAt: Timestamp,
): Result<RegistryChange, ConflictError> {
  const owner = registry.workspaces.find((w) => w.path === input.path);
  if (owner !== undefined) {
    return err(conflict(`${input.path} is already registered as ${owner.id}`, ENTITY, input.path));
  }
  if (input.id !== undefined && registry.workspaces.some((w) => w.id === input.id)) {
    return err(conflict(`Workspace id ${input.id} is already taken`, ENTITY, input.id));
  }
  const workspace: Workspace = Object.freeze({
    id: input.id ?? deriveId(registry, input),
    name: input.name,
    path: input.path,
    group: input.group,
    addedAt,
    lastActiveAt: null,
  });
  return ok({ registry: freeze([...registry.workspaces, workspace]), workspace });
}

export function findWorkspace(
  registry: WorkspaceRegistry,
  id: WorkspaceId,
): Result<Workspace, NotFoundError> {
  const workspace = registry.workspaces.find((w) => w.id === id);
  return workspace === undefined ? err(notFound(ENTITY, id)) : ok(workspace);
}

export function removeWorkspace(
  registry: WorkspaceRegistry,
  id: WorkspaceId,
): Result<{ readonly registry: WorkspaceRegistry; readonly removed: Workspace }, NotFoundError> {
  const found = findWorkspace(registry, id);
  if (!found.ok) return found;
  return ok({
    registry: freeze(registry.workspaces.filter((w) => w.id !== id)),
    removed: found.value,
  });
}

export function assignGroup(
  registry: WorkspaceRegistry,
  id: WorkspaceId,
  group: GroupName | null,
): Result<RegistryChange, NotFoundError> {
  const found = findWorkspace(registry, id);
  if (!found.ok) return found;
  const workspace: Workspace = Object.freeze({ ...found.value, group });
  return ok({
    registry: freeze(registry.workspaces.map((w) => (w.id === id ? workspace : w))),
    workspace,
  });
}

/** Records that the workspace was opened at `at`; order is unchanged. */
export function activateWorkspace(
  registry: WorkspaceRegistry,
  id: WorkspaceId,
  at: Timestamp,
): Result<RegistryChange, NotFoundError> {
  const found = findWorkspace(registry, id);
  if (!found.ok) return found;
  const workspace: Workspace = Object.freeze({ ...found.value, lastActiveAt: at });
  return ok({
    registry: freeze(registry.workspaces.map((w) => (w.id === id ? workspace : w))),
    workspace,
  });
}

/** The most recently activated workspace, or null when none has been opened yet. */
export function lastActiveWorkspace(registry: WorkspaceRegistry): Workspace | null {
  let latest: Workspace | null = null;
  for (const workspace of registry.workspaces) {
    if (workspace.lastActiveAt === null) continue;
    if (latest === null || workspace.lastActiveAt > (latest.lastActiveAt ?? 0)) latest = workspace;
  }
  return latest;
}

/** The workspace containing `path`; with nested workspaces the deepest one wins. */
export function workspaceAt(registry: WorkspaceRegistry, path: AbsolutePath): Workspace | null {
  let best: Workspace | null = null;
  for (const workspace of registry.workspaces) {
    if (!isSameOrWithin(path, workspace.path)) continue;
    if (best === null || workspace.path.length > best.path.length) best = workspace;
  }
  return best;
}
