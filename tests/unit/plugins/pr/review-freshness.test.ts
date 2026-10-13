import { expect, test } from "bun:test";
import { reviewFreshness } from "../../../../src/plugins/pr/domain/pull-request";

test("freshness compares known reviewed commits, never timestamps or missing history", () => {
  expect(
    reviewFreshness({ name: "A", status: "approved", lastReviewedCommit: "head" }, "head"),
  ).toBe("current");
  expect(
    reviewFreshness({ name: "A", status: "approved", lastReviewedCommit: "old" }, "head"),
  ).toBe("outdated");
  expect(
    reviewFreshness({ name: "A", status: "unapproved", lastReviewedCommit: "old" }, "head"),
  ).toBe("outdated");
  expect(reviewFreshness({ name: "A", status: "approved" }, "head")).toBe("unknown");
  expect(reviewFreshness({ name: "A", status: "approved", lastReviewedCommit: "" }, "head")).toBe(
    "unknown",
  );
});
