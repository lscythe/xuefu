import type { AgentQuestionAbout } from "../../../tui/shell/section-props";
import { type PullRequest, pullRequestRef } from "../domain/pull-request";

/**
 * What the agent is asked to review a pull request: read its diff and comments through XueFu,
 * and the code around them, then go through its findings with the user, each on a line with the
 * fix it suggests, and post those they settle on together, only once the user says so.
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
      "Then review it with me. Number your findings, bugs and risks first, then questions for " +
        "the author, then smaller points; give each the file and the line of the diff it is " +
        "on, and the code you would suggest when you have a fix. Say so if it looks good.",
      "We will go through them together. When I say to post, call post_comments once with " +
        "the comments we settled on, each on its line, written for the author, with your " +
        "suggestion as the code that line should become. Do not post, approve or merge " +
        "anything before I say so.",
    ].join("\n\n"),
  };
}
