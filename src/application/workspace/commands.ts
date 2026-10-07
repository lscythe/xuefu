import { z } from "zod";
import type {
  DuplicateCommandError,
  StorageError,
  ValidationError,
} from "../../domain/shared/errors";
import { createEvent, type DomainEvent } from "../../domain/shared/event";
import { type WorkspaceId, workspaceId } from "../../domain/shared/ids";
import { absolutePath, baseName } from "../../domain/shared/path";
import { ok, type Result } from "../../domain/shared/result";
import {
  activateWorkspace,
  addWorkspace,
  assignGroup,
  findWorkspace,
  removeWorkspace,
  type WorkspaceRegistry,
} from "../../domain/workspace/registry";
import { groupName, type Workspace, workspaceName } from "../../domain/workspace/workspace";
import { type CommandContext, defineCommand } from "../commands/command";
import type { CommandBus } from "../commands/command-bus";
import type { IdGenerator } from "../ports/id-generator";
import type { UnitOfWork } from "../ports/unit-of-work";
import type { WorkspaceCapabilities, WorkspaceProbe } from "../ports/workspace-probe";
import type { WorkspaceRepository } from "../ports/workspace-repository";
import { domainString } from "../validation";
import type {
  WorkspaceActivatedPayload,
  WorkspaceAddedPayload,
  WorkspaceGroupAssignedPayload,
  WorkspaceRemovedPayload,
} from "./events";

export interface WorkspaceCommandDependencies {
  readonly repository: WorkspaceRepository;
  readonly probe: WorkspaceProbe;
  readonly unitOfWork: UnitOfWork;
  readonly ids: IdGenerator;
}

export interface AddedWorkspace {
  readonly workspace: Workspace;
  readonly capabilities: WorkspaceCapabilities;
}

const CATEGORY = "Workspace";

/** Load, change and save the registry; must run inside a unit of work. */
function changeRegistry<C extends { readonly registry: WorkspaceRegistry }, E>(
  repository: WorkspaceRepository,
  change: (registry: WorkspaceRegistry) => Result<C, E>,
): Result<C, E | StorageError> {
  const loaded = repository.load();
  if (!loaded.ok) return loaded;
  const changed = change(loaded.value);
  if (!changed.ok) return changed;
  const saved = repository.save(changed.value.registry);
  return saved.ok ? changed : saved;
}

function workspaceEvent<T extends string, P extends object>(
  ids: IdGenerator,
  context: CommandContext,
  type: T,
  workspace: WorkspaceId,
  payload: P,
): DomainEvent<T, Readonly<P>> {
  return createEvent({
    id: ids.eventId(),
    type,
    version: 1,
    occurredAt: context.clock.now(),
    workspaceId: workspace,
    correlationId: context.correlationId,
    payload,
  });
}

/** The workspace registry's write side: every change goes through the command bus. */
export function workspaceCommands(deps: WorkspaceCommandDependencies) {
  const { repository, probe, unitOfWork, ids } = deps;

  const add = defineCommand({
    name: "workspace.add",
    title: "Add workspace",
    category: CATEGORY,
    safety: "safe",
    input: z.strictObject({
      path: domainString(absolutePath),
      name: domainString(workspaceName).optional(),
      id: domainString(workspaceId).optional(),
      group: domainString(groupName).optional(),
    }),
    handler: async (input, context) => {
      const probed = await probe.probe(input.path);
      if (!probed.ok) return probed;
      const { path, capabilities } = probed.value;
      // Without an explicit name the folder name is used, e.g. "mobile-banking".
      const name = input.name === undefined ? workspaceName(baseName(path)) : ok(input.name);
      if (!name.ok) return name;

      return unitOfWork.run((tx) => {
        const added = changeRegistry(repository, (registry) =>
          addWorkspace(
            registry,
            {
              name: name.value,
              path,
              group: input.group ?? null,
              ...(input.id === undefined ? {} : { id: input.id }),
            },
            context.clock.now(),
          ),
        );
        if (!added.ok) return added;
        const { workspace } = added.value;
        tx.record(
          workspaceEvent<"WorkspaceAdded", WorkspaceAddedPayload>(
            ids,
            context,
            "WorkspaceAdded",
            workspace.id,
            {
              id: workspace.id,
              name: workspace.name,
              path: workspace.path,
              group: workspace.group,
            },
          ),
        );
        return ok<AddedWorkspace>({ workspace, capabilities });
      });
    },
  });

  const remove = defineCommand({
    name: "workspace.remove",
    title: "Remove workspace",
    category: CATEGORY,
    safety: "confirm",
    input: z.strictObject({ id: domainString(workspaceId) }),
    describe: (input) => {
      const loaded = repository.load();
      const found = loaded.ok ? findWorkspace(loaded.value, input.id) : null;
      const workspace = found?.ok === true ? found.value : null;
      return {
        title: "Remove workspace",
        severity: "confirm",
        details:
          workspace === null
            ? [{ label: "Workspace", value: input.id }]
            : [
                { label: "Workspace", value: `${workspace.name} (${workspace.id})` },
                { label: "Folder", value: workspace.path },
              ],
        consequence:
          "XueFu stops tracking this workspace. The folder and its recorded history are not deleted.",
        confirmLabel: "Remove",
      };
    },
    handler: (input, context) =>
      unitOfWork.run((tx) => {
        const removed = changeRegistry(repository, (registry) =>
          removeWorkspace(registry, input.id),
        );
        if (!removed.ok) return removed;
        const workspace = removed.value.removed;
        tx.record(
          workspaceEvent<"WorkspaceRemoved", WorkspaceRemovedPayload>(
            ids,
            context,
            "WorkspaceRemoved",
            workspace.id,
            { id: workspace.id, name: workspace.name, path: workspace.path },
          ),
        );
        return ok(workspace);
      }),
  });

  const group = defineCommand({
    name: "workspace.group.assign",
    title: "Assign workspace group",
    category: CATEGORY,
    safety: "safe",
    input: z.strictObject({
      id: domainString(workspaceId),
      group: domainString(groupName).nullable(),
    }),
    handler: (input, context) =>
      unitOfWork.run((tx) => {
        const assigned = changeRegistry(repository, (registry) =>
          assignGroup(registry, input.id, input.group),
        );
        if (!assigned.ok) return assigned;
        const { workspace } = assigned.value;
        tx.record(
          workspaceEvent<"WorkspaceGroupAssigned", WorkspaceGroupAssignedPayload>(
            ids,
            context,
            "WorkspaceGroupAssigned",
            workspace.id,
            { id: workspace.id, group: workspace.group },
          ),
        );
        return ok(workspace);
      }),
  });

  const activate = defineCommand({
    name: "workspace.activate",
    title: "Switch to workspace",
    category: CATEGORY,
    safety: "safe",
    input: z.strictObject({ id: domainString(workspaceId) }),
    handler: (input, context) =>
      unitOfWork.run((tx) => {
        const activated = changeRegistry(repository, (registry) =>
          activateWorkspace(registry, input.id, context.clock.now()),
        );
        if (!activated.ok) return activated;
        const { workspace } = activated.value;
        tx.record(
          workspaceEvent<"WorkspaceActivated", WorkspaceActivatedPayload>(
            ids,
            context,
            "WorkspaceActivated",
            workspace.id,
            { id: workspace.id },
          ),
        );
        return ok(workspace);
      }),
  });

  return { add, remove, group, activate } as const;
}

export type WorkspaceCommands = ReturnType<typeof workspaceCommands>;

export function registerWorkspaceCommands(
  bus: CommandBus,
  commands: WorkspaceCommands,
): Result<void, DuplicateCommandError | ValidationError> {
  const add = bus.register(commands.add);
  if (!add.ok) return add;
  const remove = bus.register(commands.remove);
  if (!remove.ok) return remove;
  const group = bus.register(commands.group);
  if (!group.ok) return group;
  return bus.register(commands.activate);
}
