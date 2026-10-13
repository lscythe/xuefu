import { describe, expect, test } from "bun:test";
import { type PrRow, prColumns, prRows, reviewBadge } from "../../../../src/plugins/pr/tui/pr-rows";
import { pullRequest } from "../../../support/fake-pull-requests";

const text = (rows: PrRow[]) =>
  rows.map((row) =>
    row.kind === "pull" ? `#${row.pull.id}` : row.kind === "heading" ? `# ${row.text}` : row.text,
  );

describe("prRows", () => {
  test("this branch's, then yours, then those to review, under headings", () => {
    expect(
      text(
        prRows({
          branch: pullRequest(42),
          yours: [pullRequest(42), pullRequest(37)],
          toReview: [pullRequest(40)],
        }),
      ),
    ).toEqual([
      "# This branch",
      "#42",
      "",
      "# Yours (2)",
      "#42",
      "#37",
      "",
      "# To review (1)",
      "#40",
    ]);
  });

  test("why this branch has none, while it is looked for, and when nothing is open", () => {
    expect(text(prRows({ branch: "HEAD is detached in Mobile", yours: [], toReview: [] }))).toEqual(
      [
        "# This branch",
        "HEAD is detached in Mobile.",
        "",
        "No other open pull requests are yours or wait on your review.",
      ],
    );
    expect(text(prRows({ branch: null, yours: null, toReview: null }))).toEqual([
      "# This branch",
      "Looking for this branch's pull request...",
    ]);
  });
});

describe("reviewBadge", () => {
  test("approvals, in green once all approved; changes asked for, in amber", () => {
    const by = (...statuses: ("approved" | "needs-work" | "unapproved")[]) =>
      reviewBadge(
        pullRequest(1, { reviewers: statuses.map((status, i) => ({ name: `R${i}`, status })) }),
      );
    expect(by("approved", "unapproved")).toEqual({ text: "1/2 approved", tone: "textMuted" });
    expect(by("approved", "approved")).toEqual({ text: "2/2 approved", tone: "success" });
    expect(by("approved", "needs-work")).toEqual({ text: "needs work", tone: "warning" });
    expect(by()).toEqual({ text: "no reviewers", tone: "textMuted" });
  });
});

describe("prColumns", () => {
  test("fit the widest ref and review", () => {
    expect(
      prColumns(
        prRows({
          branch: null,
          yours: [
            pullRequest(7),
            pullRequest(1234, { repository: { project: "SDK", slug: "shared-sdk" } }),
          ],
          toReview: [],
        }),
      ),
    ).toEqual({
      ref: "mobile-banking#7".length,
      reviews: "0/1 approved".length,
      author: "Dana Scully".length,
    });
  });
});
