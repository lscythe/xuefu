import type { WorkspaceId } from "../shared/ids";
import type { GroupName, Workspace } from "../workspace/workspace";

/**
 * Whose timesheet: a group's, covering every workspace in it, or the one of a workspace that is in
 * no group. A day's place, leave and tasks are said per timesheet.
 */
export type TimesheetScope =
  | { readonly kind: "group"; readonly group: GroupName }
  | { readonly kind: "workspace"; readonly workspaceId: WorkspaceId };

export const groupScope = (group: GroupName): TimesheetScope => ({ kind: "group", group });

/** A workspace's timesheet: its group's, or its own when it is in none. */
export const scopeOf = (workspace: Pick<Workspace, "id" | "group">): TimesheetScope =>
  workspace.group === null
    ? { kind: "workspace", workspaceId: workspace.id }
    : { kind: "group", group: workspace.group };

/** The scope as stored and compared: "group:<name>" or "workspace:<id>". */
export const scopeKey = (scope: TimesheetScope): string =>
  scope.kind === "group" ? `group:${scope.group}` : `workspace:${scope.workspaceId}`;

export const sameScope = (a: TimesheetScope, b: TimesheetScope): boolean =>
  scopeKey(a) === scopeKey(b);

/** The scope's name as people know it: the group's, or the workspace's when it has one. */
export const scopeName = (
  scope: TimesheetScope,
  names: ReadonlyMap<string, Pick<Workspace, "name">>,
): string =>
  scope.kind === "group" ? scope.group : (names.get(scope.workspaceId)?.name ?? scope.workspaceId);
