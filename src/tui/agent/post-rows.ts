import type { DraftComment } from "../../application/ports/agent";
import type { PaletteToken } from "../theme/palette";
import { wrapText } from "../wrap";

/** A line of a drafted review as drawn. */
export interface PostRow {
  readonly text: string;
  readonly tone: PaletteToken;
  /** On the comment under the cursor. */
  readonly current: boolean;
}

/** Where the comment is: "app/src/Login.kt:11", or "…, old line 11" on a removed line. */
export const commentPlace = (comment: DraftComment) =>
  comment.old ? `${comment.file}, old line ${comment.line}` : `${comment.file}:${comment.line}`;

/**
 * A drafted review in lines of at most `width` columns: each comment's mark and place, its text,
 * and the code it suggests, as the line would become. A comment left out is dim. `starts` is the
 * row each comment begins on, to keep the one under the cursor in view.
 */
export function postRows(
  comments: readonly DraftComment[],
  chosen: ReadonlySet<number>,
  cursor: number,
  width: number,
  ascii: boolean,
): { readonly rows: PostRow[]; readonly starts: number[] } {
  const rows: PostRow[] = [];
  const starts: number[] = [];
  comments.forEach((comment, index) => {
    const current = index === cursor;
    const kept = chosen.has(index);
    const add = (text: string, tone: PaletteToken) =>
      rows.push({ text, tone: kept ? tone : "textMuted", current });
    if (index > 0) rows.push({ text: "", tone: "text", current: false });
    starts.push(rows.length);
    const mark = ascii ? (kept ? "[x]" : "[ ]") : kept ? "◉" : "○";
    add(`${mark} ${index + 1}. ${commentPlace(comment)}`, "accentSecondary");
    const indent = " ".repeat(Bun.stringWidth(mark) + 1);
    const room = Math.max(1, width - indent.length);
    for (const line of wrapText(comment.text, room)) add(`${indent}${line}`, "text");
    if (comment.suggestion !== null) {
      const sign = comment.old ? "  " : "+ ";
      for (const line of comment.suggestion.replace(/\n+$/u, "").split("\n")) {
        const shown = `${indent}${sign}${line}`;
        add(shown.length > width ? `${shown.slice(0, width - 1)}…` : shown, "success");
      }
    }
  });
  return { rows, starts };
}
