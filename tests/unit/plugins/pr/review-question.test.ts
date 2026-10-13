import { expect, test } from "bun:test";
import { INSTRUCTIONS } from "../../../../src/bootstrap/agent-context";
import { reviewQuestion } from "../../../../src/plugins/pr/tui/review-question";
import { pullRequest } from "../../../support/fake-pull-requests";

test("shared agent instructions do not impose a workspace's voice on other repositories", () => {
  const question = reviewQuestion(pullRequest(42), "bitbucket.example.com");

  expect(INSTRUCTIONS).not.toContain(
    "Write all author-facing Bitbucket review comments in casual Indonesian",
  );
  expect(INSTRUCTIONS).not.toContain("ini gak pakai yang dari ds aja?");
  expect(question.prompt).toContain("post_comments");
});
