import { expect, test } from "bun:test";
import { INSTRUCTIONS } from "../../../../src/bootstrap/agent-context";
import { reviewQuestion } from "../../../../src/plugins/pr/tui/review-question";
import { pullRequest } from "../../../support/fake-pull-requests";

test("shared agent instructions carry the Bitbucket voice into any repository", () => {
  const question = reviewQuestion(pullRequest(42), "bitbucket.example.com");

  expect(INSTRUCTIONS).toContain(
    "Write all author-facing Bitbucket review comments in casual Indonesian",
  );
  expect(INSTRUCTIONS).toContain("Keep the review discussion with the user in English");
  expect(INSTRUCTIONS).toContain("ini gak pakai yang dari ds aja?");
  expect(question.prompt).toContain("post_comments");
});
