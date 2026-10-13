import type { AgentEvent, DraftComment, DraftReview } from "../application/ports/agent";
import type { McpTools } from "../cli/mcp-server";
import { suggestedText } from "../plugins/pr/domain/comment";
import { parseDiff, placeComment, placementProblem } from "../plugins/pr/domain/diff";

/** The tool the agent posts a settled review with, once the user has chosen what goes. */
export const POST = "post_comments";
/** XueFu's tool that posts one comment, which posting a review runs for each. */
const COMMENT = "pr_comment";
/** XueFu's tool that shows a pull request's diff, which comments are placed on. */
const DIFF = "pr_diff";

export const POST_TOOL = {
  name: POST,
  description:
    "Post the review you and the user settled on, as comments on lines of a pull request's diff. " +
    "XueFu shows the user every comment, they choose which to post, and you are told what was " +
    "posted. Call it only once the user says to post; do not post comments one by one.",
  inputSchema: {
    type: "object",
    properties: {
      pullRequest: { type: "string", description: "the pull request, as PROJECT/repository#id" },
      comments: {
        type: "array",
        description: "the comments, in the order to show them",
        items: {
          type: "object",
          properties: {
            file: {
              type: "string",
              description:
                "the file's whole path, as the diff names it after b/ or dst://, without either; " +
                "never shortened",
            },
            line: {
              type: "integer",
              description:
                "a line the diff shows, added or unchanged, numbered as in the file after the " +
                "change; or with old, a removed line, numbered as before",
            },
            old: { type: "boolean", description: "the line is one the change removes" },
            text: { type: "string", description: "the comment, in Markdown, without the code" },
            suggestion: {
              type: "string",
              description:
                "what the line should become, written out whole, for the author to apply; " +
                "leave out when there is no code to suggest",
            },
          },
          required: ["file", "line", "text"],
        },
      },
    },
    required: ["pullRequest", "comments"],
  },
};

const record = (value: unknown): Readonly<Record<string, unknown>> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");

/** One drafted comment, or what is wrong with it. */
function draftComment(given: unknown, index: number): DraftComment | string {
  const comment = record(given);
  const where = `comment ${index + 1}`;
  const file = text(comment?.["file"]);
  const line = comment?.["line"];
  const said = text(comment?.["text"]);
  const suggestion = comment?.["suggestion"];
  if (file === "") return `${where} needs the file it is on`;
  if (typeof line !== "number" || !Number.isInteger(line) || line < 1) {
    return `${where} needs its line, a whole number from 1`;
  }
  if (said === "") return `${where} needs its text`;
  return {
    file,
    line,
    old: comment?.["old"] === true,
    text: said,
    suggestion: typeof suggestion === "string" && suggestion.trim() !== "" ? suggestion : null,
  };
}

/** The review the agent drafted, or what is wrong with it, as it is told. */
export function draftReview(given: unknown): DraftReview | string {
  const args = record(given);
  const pullRequest = text(args?.["pullRequest"]);
  const comments = args?.["comments"];
  if (pullRequest === "") return "pullRequest is needed, as PROJECT/repository#id";
  if (!Array.isArray(comments) || comments.length === 0) {
    return "comments is needed: at least one comment to post";
  }
  const drafted = comments.map(draftComment);
  const wrong = drafted.find((comment) => typeof comment === "string");
  if (typeof wrong === "string") return wrong;
  return { pullRequest, comments: drafted as DraftComment[] };
}

/**
 * The review with each comment placed on its line of the pull request's diff, its path as the
 * diff has it; or, when any cannot be, what is wrong with each, for the agent to put right before
 * the user is shown any. Without the diff, it stays as drafted, and posting says what fails.
 */
export async function placeReview(
  tools: McpTools,
  draft: DraftReview,
): Promise<DraftReview | string> {
  const diff = tools.tools.find((tool) => tool.name === DIFF);
  if (diff === undefined) return draft;
  const ran = await tools.run(diff.argv({ pullRequest: draft.pullRequest }));
  if (ran.code !== 0) return draft;
  const files = parseDiff(ran.stdout);
  const problems: string[] = [];
  const comments = draft.comments.map((comment, index) => {
    const side = comment.old ? "old" : "new";
    const placed = placeComment(files, comment.file, comment.line, side);
    if (placed.kind === "placed") return { ...comment, file: placed.anchor.path };
    const why = placementProblem(placed, comment.file, comment.line, side, "old: true");
    problems.push(`comment ${index + 1}: ${why}`);
    return comment;
  });
  if (problems.length === 0) return { ...draft, comments };
  return [
    "Nothing was shown to the user yet. Put each of these on a line the diff shows, with its",
    "whole path, then call post_comments again with all the comments:",
    ...problems,
  ].join("\n");
}

/** Whether reviews can be posted: XueFu's PR commands are on. */
export const canPost = (tools: McpTools) => tools.tools.some((tool) => tool.name === COMMENT);

/**
 * Posts the comments the user chose, each on its line as `xuefu pr comment` would, and says what
 * became of each, and of those left out, for the agent. `tell` shows the user how far it is, and
 * what became of each as it does.
 */
export async function postReview(
  tools: McpTools,
  draft: DraftReview,
  chosen: readonly DraftComment[],
  tell: (event: AgentEvent) => void,
): Promise<string> {
  const comment = tools.tools.find((tool) => tool.name === COMMENT);
  if (comment === undefined || chosen.length === 0) {
    return "The user posted none of them. Ask what they would change.";
  }
  const said: string[] = [];
  for (const [index, each] of chosen.entries()) {
    tell({ kind: "posting", done: index, of: chosen.length });
    const argv = comment.argv({
      pullRequest: draft.pullRequest,
      file: each.file,
      line: String(each.line),
      message: suggestedText(each.text, each.suggestion, each.old ? "old" : "new"),
      old: each.old,
      yes: true,
    });
    const ran = await tools.run(argv);
    const where = `${each.file}:${each.line}`;
    const why = (ran.stderr.trim() || ran.stdout.trim()).split("\n").at(-1) ?? "";
    const result = ran.code === 0 ? `Posted on ${where}` : `Could not post on ${where}: ${why}`;
    tell({ kind: "step", text: result, failed: ran.code !== 0 });
    said.push(ran.code === 0 ? `${result}.` : result);
  }
  tell({ kind: "posting", done: chosen.length, of: chosen.length });
  const left = draft.comments.length - chosen.length;
  if (left > 0) said.push(`The user left out ${left} of them.`);
  return said.join("\n");
}
