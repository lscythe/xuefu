import type { AgentQuestionAbout } from "../../../tui/shell/section-props";
import { type PullRequest, pullRequestRef, repositoryFromRemote } from "../domain/pull-request";

/**
 * What the agent is asked to review a pull request: read its diff and comments through XueFu,
 * and the code around them, then go through its findings with the user, each on a line with the
 * fix it suggests, and post those they settle on together, only once the user says so. It works
 * in the workspace that holds a clone of the pull request's repository on the Bitbucket at `host`.
 */
export function reviewQuestion(pull: PullRequest, host: string): AgentQuestionAbout {
  const ref = pullRequestRef(pull);
  const { project, slug } = pull.repository;
  return {
    title: `Review ${ref}`,
    repository: {
      name: `${project}/${slug}`,
      holds: (origin) => {
        const cloned = repositoryFromRemote(origin, host);
        return (
          cloned !== null &&
          cloned.project === project.toUpperCase() &&
          cloned.slug === slug.toLowerCase()
        );
      },
    },
    branch: pull.from,
    prompt: [
      `Review the pull request ${ref}, "${pull.title}", from ${pull.from} into ${pull.to}.`,
      `Read its diff and comment threads with XueFu's pr_diff and pr_comments tools, passing ` +
        `pullRequest "${ref}". When this folder is a clone of the repository, XueFu checks out ` +
        `${pull.from} here as it is on origin before you start, so read the code around the ` +
        "changes here. Should that have failed, another branch is checked out, so what changes " +
        "is always what the diff says.",
      "Then review it with me. Number your findings, bugs and risks first, then questions for " +
        "the author, then smaller points; give each the file and the line of the diff it is " +
        "on, and the code you would suggest when you have a fix. Say so if it looks good.",
      "We will go through them together. When I say to post, call post_comments once with " +
        "the comments we settled on, each on a line the diff shows, with the file's whole path " +
        "as the diff names it, written for the author, with your suggestion as the code that " +
        "line should become. Do not post, approve or merge anything before I say so.",
    ].join("\n\n"),
  };
}
