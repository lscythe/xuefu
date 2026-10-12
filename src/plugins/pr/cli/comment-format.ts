import { anchorText, type PullRequestComment } from "../domain/comment";

const indent = (text: string, by: string) =>
  text
    .split("\n")
    .map((line) => (line === "" ? "" : `${by}${line}`))
    .join("\n");

/** What sets a comment apart: a to-do, its thread resolved, or the code it was on changed. */
function marks(comment: PullRequestComment): string[] {
  return [
    comment.todo === "open" ? "to do" : comment.todo === "done" ? "done" : null,
    comment.resolved ? "resolved" : null,
    comment.anchor?.outdated === true ? "outdated" : null,
  ].filter((mark) => mark !== null);
}

function formatComment(
  comment: PullRequestComment,
  when: (at: number) => string,
  depth: number,
): string[] {
  const pad = "  ".repeat(depth);
  const heading = [
    `#${comment.id}`,
    comment.author,
    when(comment.created),
    ...(depth === 0 && comment.anchor !== null ? [anchorText(comment.anchor)] : []),
    ...marks(comment),
  ].join(" · ");
  return [
    `${pad}${depth === 0 ? "" : "↳ "}${heading}`,
    indent(comment.text.trim(), `${pad}  `),
    ...comment.replies.flatMap((reply) => formatComment(reply, when, depth + 1)),
  ];
}

/**
 * Comment threads one after another, each with its id to reply to, who wrote it and when, and
 * where it is in the diff; replies are indented under what they answer.
 */
export function formatThreads(
  threads: readonly PullRequestComment[],
  when: (at: number) => string,
): string {
  return `${threads.map((thread) => formatComment(thread, when, 0).join("\n")).join("\n\n")}\n`;
}

/** A comment for --json, with its dates as ISO 8601. */
export function commentJson(comment: PullRequestComment): unknown {
  return {
    ...comment,
    created: new Date(comment.created).toISOString(),
    updated: new Date(comment.updated).toISOString(),
    replies: comment.replies.map(commentJson),
  };
}
