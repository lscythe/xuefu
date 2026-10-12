import type { AgentQuestionAbout } from "../../../tui/shell/section-props";
import { type PullRequest, pullRequestRef } from "../domain/pull-request";

/**
 * What the agent is asked to review a pull request: read its diff and comments through XueFu,
 * and the code around them, then say what matters, without acting on it unless asked.
 */
export function reviewQuestion(pull: PullRequest): AgentQuestionAbout {
  const ref = pullRequestRef(pull);
  return {
    title: `Review ${ref}`,
    prompt: [
      `Review the pull request ${ref}, "${pull.title}", from ${pull.from} into ${pull.to}.`,
      `Read its diff and comment threads with XueFu's pr_diff and pr_comments tools, passing ` +
        `pullRequest "${ref}", and the code around the changes in this folder when it is the ` +
        "same repository.",
      "Then review it briefly: bugs and risks first, each with its file and line, then " +
        "questions for the author, then smaller points. Say so if it looks good.",
      "Do not comment on, approve or merge it unless I ask.",
    ].join("\n\n"),
  };
}
