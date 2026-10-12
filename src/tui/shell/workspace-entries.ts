import type { DispatchOptions } from "../../application/commands/command-bus";
import type { AppError } from "../../application/errors";
import type { OpenTabs } from "../../application/workspace/queries";
import { assertNever } from "../../domain/shared/assert-never";
import { ok, type Result } from "../../domain/shared/result";
import { groupName, type Workspace, workspaceName } from "../../domain/workspace/workspace";
import type { PaletteEntry } from "../palette/palette-model";

/** Changing which workspaces XueFu tracks, from the cockpit. */
export interface ManageWorkspaces {
  /**
   * Registers a folder, `~` and relative paths read from where XueFu was started, and opens it in
   * a tab; resolves to the open tabs.
   */
  readonly add: (
    folder: string,
    name: string | null,
    group: string | null,
  ) => Promise<Result<OpenTabs, AppError>>;
  readonly rename: (workspace: Workspace, name: string) => Promise<Result<unknown, AppError>>;
  /** Puts the workspace in `group`, or with null takes it out of its group. */
  readonly group: (
    workspace: Workspace,
    group: string | null,
  ) => Promise<Result<unknown, AppError>>;
  /** Stops tracking the workspace; asks first, so it is run again with the approval. */
  readonly remove: (
    workspace: Workspace,
    options?: DispatchOptions,
  ) => Promise<Result<unknown, AppError>>;
}

/** What can be done to a workspace, from the palette or on one picked in the switcher. */
export type WorkspaceChange = "add" | "rename" | "group" | "remove";

/** What the entries do once their fields are filled in. */
export interface WorkspaceEntryActions {
  readonly add: (
    folder: string,
    name: string | null,
    group: string | null,
  ) => Promise<Result<unknown, AppError>>;
  readonly rename: (workspace: Workspace, name: string) => Promise<Result<unknown, AppError>>;
  readonly group: (
    workspace: Workspace,
    group: string | null,
  ) => Promise<Result<unknown, AppError>>;
  /** Closes the palette, then asks before removing; the answer is the confirmation's. */
  readonly remove: (workspace: Workspace) => void;
}

const anything = (raw: string) => ok(raw);

function addEntry(actions: WorkspaceEntryActions): PaletteEntry {
  return {
    title: "Add workspace",
    keys: null,
    fields: [
      { label: "Folder", example: "~/Projects/mobile-banking", optional: false, check: anything },
      { label: "Name", example: "the folder's name", optional: true, check: workspaceName },
      { label: "Group", example: "Banking Client", optional: true, check: groupName },
    ],
    run: ([folder, name, group]) => actions.add(folder ?? "", name ?? null, group ?? null),
  };
}

function renameEntry(workspace: Workspace, actions: WorkspaceEntryActions): PaletteEntry {
  return {
    title: `Rename ${workspace.name}`,
    keys: null,
    fields: [{ label: "Name", example: workspace.name, optional: false, check: workspaceName }],
    run: ([name]) => actions.rename(workspace, name ?? ""),
  };
}

function groupEntry(workspace: Workspace, actions: WorkspaceEntryActions): PaletteEntry {
  return {
    title: `Move ${workspace.name} to a group`,
    keys: null,
    fields: [
      {
        label: "Group",
        example: workspace.group ?? "Banking Client",
        optional: false,
        check: groupName,
      },
    ],
    run: ([group]) => actions.group(workspace, group ?? null),
  };
}

function removeEntry(workspace: Workspace, actions: WorkspaceEntryActions): PaletteEntry {
  return {
    title: `Remove ${workspace.name}`,
    keys: null,
    fields: [],
    run: () => {
      actions.remove(workspace);
      return Promise.resolve(ok(undefined));
    },
  };
}

/** The entry for `change`, on `workspace` where it acts on one; null when there is none to act on. */
export function workspaceEntry(
  change: WorkspaceChange,
  workspace: Workspace | null,
  actions: WorkspaceEntryActions,
): PaletteEntry | null {
  switch (change) {
    case "add":
      return addEntry(actions);
    case "rename":
      return workspace === null ? null : renameEntry(workspace, actions);
    case "group":
      return workspace === null ? null : groupEntry(workspace, actions);
    case "remove":
      return workspace === null ? null : removeEntry(workspace, actions);
    default:
      return assertNever(change);
  }
}

/** Every change to the workspace in front, and adding one, for the palette. */
export function workspaceEntries(
  workspace: Workspace | null,
  actions: WorkspaceEntryActions,
): PaletteEntry[] {
  if (workspace === null) return [addEntry(actions)];
  const entries = [
    addEntry(actions),
    renameEntry(workspace, actions),
    groupEntry(workspace, actions),
  ];
  if (workspace.group !== null) {
    entries.push({
      title: `Take ${workspace.name} out of ${workspace.group}`,
      keys: null,
      fields: [],
      run: () => actions.group(workspace, null),
    });
  }
  entries.push(removeEntry(workspace, actions));
  return entries;
}
