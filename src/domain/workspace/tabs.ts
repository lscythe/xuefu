import type { WorkspaceId } from "../shared/ids";

/** Workspaces open side by side in the cockpit, in tab order, and the one in front. */
export interface WorkspaceTabs {
  readonly open: readonly WorkspaceId[];
  /** Always one of `open`, or null exactly when nothing is open. */
  readonly active: WorkspaceId | null;
}

/** Alt+1..9 address the tabs, so there are never more than nine. */
export const MAX_TABS = 9;

export const NO_TABS: WorkspaceTabs = Object.freeze({ open: Object.freeze([]), active: null });

function tabsOf(open: readonly WorkspaceId[], active: WorkspaceId | null): WorkspaceTabs {
  return Object.freeze({
    open: Object.freeze([...open]),
    active: open.length === 0 ? null : active,
  });
}

/**
 * Brings `id` to the front: focuses its tab if open, otherwise appends a tab. With every slot
 * taken the new workspace replaces the active tab in place rather than growing past the limit.
 */
export function openTab(tabs: WorkspaceTabs, id: WorkspaceId): WorkspaceTabs {
  if (tabs.open.includes(id)) return tabsOf(tabs.open, id);
  if (tabs.open.length < MAX_TABS) return tabsOf([...tabs.open, id], id);
  return tabsOf(
    tabs.open.map((open) => (open === tabs.active ? id : open)),
    id,
  );
}

/** Closes `id`; closing the active tab focuses the tab to its right, else the one to its left. */
export function closeTab(tabs: WorkspaceTabs, id: WorkspaceId): WorkspaceTabs {
  const index = tabs.open.indexOf(id);
  if (index === -1) return tabs;
  const open = tabs.open.filter((other) => other !== id);
  if (tabs.active !== id) return tabsOf(open, tabs.active);
  return tabsOf(open, open[index] ?? open[index - 1] ?? null);
}

/** The workspace in tab `position` (1-based, matching Alt+1..9), or null. */
export function tabAt(tabs: WorkspaceTabs, position: number): WorkspaceId | null {
  return position >= 1 ? (tabs.open[position - 1] ?? null) : null;
}

/** Drops tabs whose workspace was removed, refocusing as if each had been closed. */
export function retainTabs(tabs: WorkspaceTabs, existing: ReadonlySet<WorkspaceId>): WorkspaceTabs {
  return tabs.open.filter((id) => !existing.has(id)).reduce(closeTab, tabs);
}
