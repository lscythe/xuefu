import reviewVoice from "../../PERSON.md" with { type: "text" };
import type { ProjectBrief } from "../application/ports/project-context";
import type { Timestamp } from "../domain/shared/time";
import type { Workspace } from "../domain/workspace/workspace";

const DAY_MS = 24 * 60 * 60 * 1000;
/** How long a brief is trusted before the workspace is studied again. */
const BRIEF_MAX_AGE_MS = 14 * DAY_MS;

/** What the agent is told of where it runs, whatever it is asked. */
export const INSTRUCTIONS =
  "You are running inside XueFu, the user's terminal developer cockpit, which shows what you " +
  "say in a small terminal dialog: keep answers short, in plain text, without tables. XueFu's " +
  "tools read and act on the user's workspaces, work, Jira issues and Bitbucket pull requests, " +
  "and you may read the files in this folder. The user approves every change in XueFu before " +
  "it runs, so pass yes set to true to tools that change something.\n\n" +
  reviewVoice.trim();

const GRAPH =
  "graf's tools answer questions about the structure of the code: what calls what, what a file " +
  "or symbol depends on, and what depends on it. When reviewing a change, use impact on the " +
  "files and symbols it touches to see what else it affects.";

/** A brief still to be trusted: one a workspace, renewed every two weeks. */
export function freshBrief(brief: ProjectBrief | null, now: Timestamp): brief is ProjectBrief {
  return brief !== null && now - brief.createdAt < BRIEF_MAX_AGE_MS;
}

/** "today", "yesterday" or "3 days ago", for when a brief was written. */
export function briefAge(brief: ProjectBrief, now: Timestamp): string {
  const days = Math.max(0, Math.floor((now - brief.createdAt) / DAY_MS));
  return days === 0 ? "today" : days === 1 ? "yesterday" : `${days} days ago`;
}

/**
 * What the agent is asked when it studies a workspace: learn it, then write itself a brief of its
 * context and the practices it follows, kept for every conversation after.
 */
export function studyPrompt(withGraph: boolean): string {
  return [
    "Study this project, so that you can review changes to it and answer questions about it " +
      "well from now on.",
    `${withGraph ? "Learn its structure with graf's tools, such as stats, god_nodes, get_community and query, then read " : "Read "}` +
      "its own guidance: the README, CLAUDE.md or AGENTS.md, notes on contributing, and the " +
      "lint, format, build and test configuration; then a few of its central files.",
    "Then write a brief for yourself in at most 60 lines of plain text: what the project is; its " +
      "architecture, main modules and how they depend on one another; the conventions and best " +
      "practices it follows, such as naming, layering, error handling, testing and style; and " +
      "what a reviewer should watch for here. Change nothing. Answer with the brief alone.",
  ].join("\n\n");
}

const NO_CODE =
  "No workspace of the user's holds the code you are asked about, so this folder is empty: read " +
  "the changes through XueFu's tools, such as pr_diff and pr_comments, and say so when a finding " +
  "would need the code around them.";

/**
 * The instructions for a conversation: where it runs, the graph if any, and the brief if any; for
 * no workspace, that there is no code at hand.
 */
export function instructionsFor(
  workspace: Workspace | null,
  brief: ProjectBrief | null,
  withGraph: boolean,
  now: Timestamp,
): string {
  if (workspace === null) return [INSTRUCTIONS, NO_CODE].join("\n\n");
  return [
    INSTRUCTIONS,
    ...(withGraph ? [GRAPH] : []),
    ...(brief === null
      ? []
      : [
          `What you learned of ${workspace.name} when you studied it ${briefAge(brief, now)}:`,
          brief.text.trim(),
        ]),
  ].join("\n\n");
}
