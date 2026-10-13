import { expect, test } from "bun:test";
import { filterPrLists } from "../../../../src/plugins/pr/tui/pr-filter";
import { pullRequest } from "../../../support/fake-pull-requests";

const yours = pullRequest(42, { title: "Add biometric login", author: "Dana Scully" });
const review = pullRequest(40, {
  title: "Fix rotate crash",
  author: "Fox Mulder",
  reviewers: [{ name: "Dana", status: "needs-work", lastReviewedCommit: "old" }],
});
const lists = { branch: yours, yours: [yours], toReview: [review] };

test("search matches titles, authors and PR numbers without changing loaded data", () => {
  expect(filterPrLists(lists, "FOX", "all").toReview).toEqual([review]);
  expect(filterPrLists(lists, "#42", "all").yours).toEqual([yours]);
  expect(filterPrLists(lists, "biometric", "all").yours).toEqual([yours]);
  expect(filterPrLists(lists, "not found", "all").yours).toEqual([]);
  expect(lists.yours).toEqual([yours]);
});

test("filters can combine with search, including branch entries", () => {
  expect(filterPrLists(lists, "", "to-review")).toEqual({
    branch: null,
    yours: [],
    toReview: [review],
  });
  expect(filterPrLists(lists, "", "needs-work").toReview).toEqual([review]);
  expect(filterPrLists(lists, "", "outdated").toReview).toEqual([review]);
  expect(filterPrLists(lists, "Dana", "outdated").toReview).toEqual([]);
  expect(filterPrLists({ branch: null, yours: null, toReview: null }, "", "all")).toEqual({
    branch: null,
    yours: null,
    toReview: null,
  });
});
