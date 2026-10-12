/** Where a comment sits in the diff: on a file, or on one of its lines. */
export interface CommentAnchor {
  readonly path: string;
  /** The line's number, in the file before when `side` is "old", else in the file after. */
  readonly line: number | null;
  readonly side: "old" | "new";
  /** Whether the line was added, removed or left as it was; null for a comment on the file. */
  readonly lineKind: "added" | "removed" | "context" | null;
  /** Whether the code it was on has changed since, so it no longer shows in the diff. */
  readonly outdated: boolean;
}

export interface PullRequestComment {
  readonly id: number;
  /** Counts its edits; changing or deleting it names this. */
  readonly version: number;
  readonly author: string;
  readonly text: string;
  /** Milliseconds since the epoch. */
  readonly created: number;
  readonly updated: number;
  /** Null for a comment on the pull request as a whole. */
  readonly anchor: CommentAnchor | null;
  /** A to-do a reviewer asked for, open or done; null for an ordinary comment. */
  readonly todo: "open" | "done" | null;
  /** Whether its thread was marked resolved. */
  readonly resolved: boolean;
  /** Replies, oldest first, each with its own. */
  readonly replies: readonly PullRequestComment[];
}

/** "app/src/Login.kt, line 11", "…, old line 11", or the path alone for a file comment. */
export function anchorText(anchor: CommentAnchor): string {
  if (anchor.line === null) return anchor.path;
  return `${anchor.path}, ${anchor.side === "old" ? "old line" : "line"} ${anchor.line}`;
}
