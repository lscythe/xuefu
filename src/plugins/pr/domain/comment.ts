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

/** A comment to post: on the pull request, on a line of its diff, or in reply to another. */
export interface CommentDraft {
  readonly text: string;
  /** The line it is on; null for the pull request as a whole, or a reply. */
  readonly anchor: Omit<CommentAnchor, "outdated"> | null;
  /** The comment it answers; null for one that starts a thread. */
  readonly replyTo: number | null;
}

/**
 * A comment's text with the code it suggests, if any. On a line of the file after, the code is a
 * suggestion block, which Bitbucket lets the author apply in place of the line; on a removed line
 * there is nothing to replace, so it is plain code. The fence outruns any backticks in the code.
 */
export function suggestedText(
  text: string,
  suggestion: string | null,
  side: "old" | "new",
): string {
  if (suggestion === null) return text;
  const longest = Math.max(0, ...(suggestion.match(/`+/gu) ?? []).map((run) => run.length));
  const fence = "`".repeat(Math.max(3, longest + 1));
  const code = suggestion.replace(/\n+$/u, "");
  return `${text}\n\n${fence}${side === "new" ? "suggestion" : ""}\n${code}\n${fence}`;
}

/** "app/src/Login.kt, line 11", "…, old line 11", or the path alone for a file comment. */
export function anchorText(anchor: Pick<CommentAnchor, "path" | "line" | "side">): string {
  if (anchor.line === null) return anchor.path;
  return `${anchor.path}, ${anchor.side === "old" ? "old line" : "line"} ${anchor.line}`;
}
