import { describe, expect, test } from "bun:test";
import {
  parsePullRequestRef,
  pullRequestRef,
  reviewSummary,
} from "../../../../src/plugins/pr/domain/pull-request";

describe("pull request refs", () => {
  test("read as PROJECT/repository#id, the project upper-cased", () => {
    expect(parsePullRequestRef(" mob/mobile-banking#42 ")).toEqual({
      ok: true,
      value: { repository: { project: "MOB", slug: "mobile-banking" }, id: 42 },
    });
    expect(parsePullRequestRef("~dscully/dotfiles#3")).toMatchObject({
      ok: true,
      value: { repository: { project: "~dscully" } },
    });
  });

  test("written the same way", () => {
    expect(pullRequestRef({ repository: { project: "MOB", slug: "app" }, id: 7 })).toBe(
      "MOB/app#7",
    );
  });

  test("anything else is refused, saying how one looks", () => {
    for (const raw of ["42", "MOB#42", "MOB/app", "MOB/app#0", "MOB/a b#1"]) {
      const parsed = parsePullRequestRef(raw);
      expect(parsed.ok ? null : parsed.error.issues[0]?.message).toBe(
        "must look like PROJECT/repository#42",
      );
    }
  });
});

describe("reviewSummary", () => {
  test("counts approvals and requests for changes", () => {
    expect(
      reviewSummary({
        reviewers: [
          { name: "A", status: "approved" },
          { name: "B", status: "needs-work" },
          { name: "C", status: "unapproved" },
        ],
      }),
    ).toEqual({ approved: 1, reviewers: 3, needsWork: 1 });
  });
});
