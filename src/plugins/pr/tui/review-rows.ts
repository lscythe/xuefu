import { wrapText } from "../../../tui/wrap";
import type { CommentAnchor, PullRequestComment } from "../domain/comment";
import { type DiffFile, type DiffLine, filePath } from "../domain/diff";

/** A line of the diff, and where a comment on it goes. */
export interface LineRow {
  readonly kind: "line";
  readonly line: DiffLine;
  readonly anchor: Omit<CommentAnchor, "outdated">;
}

/** The first line of a comment: who wrote it and when, under the thread it belongs to. */
export interface CommentRow {
  readonly kind: "comment";
  readonly comment: PullRequestComment;
  /** The comment that starts its thread, which a reply goes under. */
  readonly thread: number;
  readonly depth: number;
}

/** A row of the review: the diff's files, hunks and lines, with comment threads under them. */
export type ReviewRow =
  | { readonly kind: "heading"; readonly text: string }
  | { readonly kind: "file"; readonly file: DiffFile }
  | { readonly kind: "hunk"; readonly header: string }
  | LineRow
  | CommentRow
  /** A line of a comment's text, wrapped to the width. */
  | { readonly kind: "text"; readonly text: string; readonly depth: number }
  | { readonly kind: "blank" };

/** Rows the cursor stops on: a line to comment on, or a comment to reply to. */
export const selectable = (row: ReviewRow): row is LineRow | CommentRow =>
  row.kind === "line" || row.kind === "comment";

const placeKey = (path: string, side: "old" | "new", line: number | null) =>
  `${path}\u0000${side}\u0000${line ?? ""}`;

/** Columns a comment's text is indented by at `depth`, past the gutter. */
export const commentIndent = (depth: number) => 4 + 2 * depth;

function threadRows(thread: PullRequestComment, width: number): ReviewRow[] {
  const rows: ReviewRow[] = [];
  const walk = (comment: PullRequestComment, depth: number) => {
    rows.push({ kind: "comment", comment, thread: thread.id, depth });
    for (const text of wrapText(comment.text.trim(), Math.max(10, width - commentIndent(depth)))) {
      rows.push({ kind: "text", text, depth });
    }
    for (const reply of comment.replies) walk(reply, depth + 1);
  };
  walk(thread, 0);
  return rows;
}

/**
 * The review as rows `width` columns wide: comments on the whole pull request first, then each
 * file with its comments, then its hunks, each line followed by the threads on it. Threads on code
 * that has since changed, or on lines the diff no longer shows, come last.
 */
export function reviewRows(
  files: readonly DiffFile[],
  threads: readonly PullRequestComment[],
  width: number,
): ReviewRow[] {
  const placed = new Map<string, PullRequestComment[]>();
  const general: PullRequestComment[] = [];
  const shown = new Set<string>();
  for (const file of files) {
    const path = filePath(file);
    shown.add(placeKey(path, "new", null));
    for (const line of file.hunks.flatMap((hunk) => hunk.lines)) {
      if (line.kind === "removed") shown.add(placeKey(path, "old", line.old));
      else shown.add(placeKey(path, "new", line.new));
    }
  }
  const elsewhere: PullRequestComment[] = [];
  for (const thread of threads) {
    const { anchor } = thread;
    if (anchor === null) {
      general.push(thread);
      continue;
    }
    // A comment on a whole file sits with the file, whichever side it names.
    const key = placeKey(anchor.path, anchor.line === null ? "new" : anchor.side, anchor.line);
    if (anchor.outdated || !shown.has(key)) {
      elsewhere.push(thread);
      continue;
    }
    placed.set(key, [...(placed.get(key) ?? []), thread]);
  }

  const rows: ReviewRow[] = [];
  const threadsAt = (key: string) => (placed.get(key) ?? []).flatMap((t) => threadRows(t, width));
  if (general.length > 0) {
    rows.push({ kind: "heading", text: "On the pull request" });
    for (const thread of general) rows.push(...threadRows(thread, width), { kind: "blank" });
  }
  for (const file of files) {
    const path = filePath(file);
    rows.push({ kind: "file", file }, ...threadsAt(placeKey(path, "new", null)));
    for (const hunk of file.hunks) {
      rows.push({ kind: "hunk", header: hunk.header });
      for (const line of hunk.lines) {
        const side = line.kind === "removed" ? "old" : "new";
        const number = (side === "old" ? line.old : line.new) ?? 0;
        rows.push({
          kind: "line",
          line,
          anchor: { path, line: number, side, lineKind: line.kind },
        });
        rows.push(...threadsAt(placeKey(path, side, number)));
      }
    }
    rows.push({ kind: "blank" });
  }
  if (elsewhere.length > 0) {
    rows.push({ kind: "heading", text: "On code that has changed since" });
    for (const thread of elsewhere) rows.push(...threadRows(thread, width), { kind: "blank" });
  }
  return rows;
}
