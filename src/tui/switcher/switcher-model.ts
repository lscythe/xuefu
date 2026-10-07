import { rankFuzzy } from "../../application/search/fuzzy";
import type { WorkspaceView } from "../../application/workspace/queries";

export type SwitcherRow =
  | { readonly kind: "group"; readonly label: string }
  | {
      readonly kind: "workspace";
      readonly view: WorkspaceView;
      /** Matched code-point positions in the name and in the id, for highlighting. */
      readonly nameHits: readonly number[];
      readonly idHits: readonly number[];
    };

const UNGROUPED = "Ungrouped";
const NAME_KEY = 0;
const ID_KEY = 1;

function workspaceRow(
  view: WorkspaceView,
  hits: { key: number; positions: readonly number[] } | null = null,
): SwitcherRow {
  return {
    kind: "workspace",
    view,
    nameHits: hits?.key === NAME_KEY ? hits.positions : [],
    idHits: hits?.key === ID_KEY ? hits.positions : [],
  };
}

function grouped(views: readonly WorkspaceView[]): SwitcherRow[] {
  if (views.every((view) => view.workspace.group === null)) {
    return views.map((view) => workspaceRow(view));
  }
  // Keyed by group, null for ungrouped, so a group literally named "Ungrouped" stays separate.
  const byGroup = new Map<string | null, WorkspaceView[]>();
  for (const view of views) {
    const group = view.workspace.group;
    byGroup.set(group, [...(byGroup.get(group) ?? []), view]);
  }
  const groups = [...byGroup.keys()].sort((a, b) =>
    a === null ? 1 : b === null ? -1 : a.localeCompare(b),
  );
  return groups.flatMap((group) => [
    { kind: "group", label: group ?? UNGROUPED } as const,
    ...(byGroup.get(group) ?? []).map((view) => workspaceRow(view)),
  ]);
}

/**
 * Rows to show for a query: grouped in registry order when the query is blank, otherwise a flat
 * list ranked by how well the name, id or group matches.
 */
export function switcherRows(views: readonly WorkspaceView[], query: string): SwitcherRow[] {
  const trimmed = query.trim();
  if (trimmed === "") return grouped(views);
  return rankFuzzy(views, trimmed, (view) => [
    view.workspace.name,
    view.workspace.id,
    view.workspace.group ?? "",
  ]).map(({ item, match, key }) => workspaceRow(item, { key, positions: match.positions }));
}

/** Drops the last character (a whole code point, so CJK and emoji erase cleanly). */
export function eraseChar(query: string): string {
  return Array.from(query).slice(0, -1).join("");
}

/** Ctrl+W: trailing spaces, then the last word, or the last run of punctuation if there is none. */
export function eraseWord(query: string): string {
  const trimmed = query.replace(/\s+$/u, "");
  const withoutWord = trimmed.replace(/[\p{L}\p{N}]+$/u, "");
  return withoutWord !== trimmed ? withoutWord : trimmed.replace(/[^\p{L}\p{N}\s]+$/u, "");
}

/** Pasted text as query input: whitespace runs become one space, control characters go. */
export function pastedText(text: string): string {
  return text.replace(/\s+/gu, " ").replace(/\p{C}/gu, "");
}

/** First visible row for a window of `height` rows, keeping `selected` near the middle. */
export function scrollOffset(selected: number, rowCount: number, height: number): number {
  const centred = selected - Math.floor(height / 2);
  return Math.max(0, Math.min(centred, rowCount - height));
}
