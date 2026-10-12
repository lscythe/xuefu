import type { AppError } from "../../../application/errors";
import type { PluginInvocation } from "../../../cli/plugin-command";
import { validationError } from "../../../domain/shared/errors";
import { err, ok, type Result } from "../../../domain/shared/result";
import type { PullRequestClient } from "../application/pull-request-client";
import type { CommentDraft } from "../domain/comment";
import { lineAnchor, parseDiff } from "../domain/diff";
import type { PullRequest } from "../domain/pull-request";

const refused = (path: string, message: string) =>
  err(validationError("Comment is invalid", [{ path, message }]));

/** A whole number from 1, as typed after a flag; null when it is not one. */
function positive(raw: string): number | null {
  return /^[1-9]\d{0,8}$/.test(raw) ? Number(raw) : null;
}

/**
 * The comment `xuefu pr comment` was asked to post. A line comment is checked against the diff, so
 * one on a line it does not show is refused here rather than by Bitbucket.
 */
export async function commentDraft(
  client: PullRequestClient,
  pull: PullRequest,
  flags: PluginInvocation["flags"],
): Promise<Result<CommentDraft, AppError>> {
  const text = typeof flags["message"] === "string" ? flags["message"].trim() : "";
  if (text === "") return refused("message", "say what to post, with -m");
  const file = typeof flags["file"] === "string" ? flags["file"] : null;
  const line = typeof flags["line"] === "string" ? flags["line"] : null;
  const reply = typeof flags["reply"] === "string" ? flags["reply"] : null;

  if (reply !== null) {
    if (file !== null || line !== null) {
      return refused("reply", "a reply goes in its thread; leave out --file and --line");
    }
    const replyTo = positive(reply.replace(/^#/, ""));
    if (replyTo === null) return refused("reply", "must be a comment's id, as pr comments shows");
    return ok({ text, anchor: null, replyTo });
  }
  if (file === null && line === null) return ok({ text, anchor: null, replyTo: null });
  if (file === null) return refused("file", "say which file the line is in, with --file");
  if (line === null) return refused("line", "say which line, with --line");
  const number = positive(line);
  if (number === null) return refused("line", "must be a line number, from 1");

  const diff = await client.diff(pull.repository, pull.id);
  if (!diff.ok) return diff;
  const side = flags["old"] === true ? "old" : "new";
  const anchor = lineAnchor(parseDiff(diff.value), file, number, side);
  if (anchor === null) {
    return refused(
      "line",
      side === "old"
        ? `line ${number} of ${file} as it was is not removed in the diff`
        : `line ${number} of ${file} is not in the diff; for a removed line, add --old`,
    );
  }
  return ok({ text, anchor, replyTo: null });
}
