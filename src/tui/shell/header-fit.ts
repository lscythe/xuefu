import { truncateToWidth } from "./tab-labels";

export interface HeaderLeft {
  readonly name: string;
  /** The work's title, shortened or dropped (null) to make room. */
  readonly title: string | null;
}

/** Columns between the workspace name and the work: "  │  ". */
const WORK_SEPARATOR_WIDTH = 5;
/** A title or name shorter than this says nothing useful, so it is dropped or kept whole. */
const MIN_USEFUL = 4;

/**
 * Fits "name  │  KEY title" into `budget` columns: the title gives way first, then the name. The
 * issue key is never cut, since a partial key is misleading.
 */
export function fitHeaderLeft(
  name: string,
  work: { readonly key: string; readonly title: string | null } | null,
  budget: number,
): HeaderLeft {
  const nameWidth = Bun.stringWidth(name);
  if (work === null) return { name: truncateToWidth(name, Math.max(1, budget)), title: null };
  const keyPart = WORK_SEPARATOR_WIDTH + Bun.stringWidth(work.key);
  if (work.title !== null) {
    const titleRoom = budget - nameWidth - keyPart - 1;
    if (titleRoom >= MIN_USEFUL) {
      return { name, title: truncateToWidth(work.title, titleRoom) };
    }
  }
  return { name: truncateToWidth(name, Math.max(MIN_USEFUL, budget - keyPart)), title: null };
}
