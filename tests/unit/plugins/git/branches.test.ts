import { describe, expect, test } from "bun:test";
import { ok } from "../../../../src/domain/shared/result";
import { branchName, parseBranches } from "../../../../src/plugins/git/domain/branches";

describe("branchName", () => {
  test.each(["main", "feature/MOB-2841-login", "release-1.2", "a.b", "user@host"])(
    "accepts %s",
    (raw) => {
      expect(branchName(raw)).toEqual(ok(raw as never));
    },
  );

  test.each([
    ["", "must not be empty"],
    ["has space", "must not contain spaces or any of ~ ^ : ? * [ \\"],
    ["a:b", "must not contain spaces or any of ~ ^ : ? * [ \\"],
    ["-x", "must not start with a dash"],
    ["a..b", 'must not be "@" or contain ".." or "@{"'],
    ["@", 'must not be "@" or contain ".." or "@{"'],
    ["a@{1}", 'must not be "@" or contain ".." or "@{"'],
    ["a//b", 'each part between slashes must be non-empty, not start with "." or end with ".lock"'],
    ["a/.b", 'each part between slashes must be non-empty, not start with "." or end with ".lock"'],
    [
      "a.lock",
      'each part between slashes must be non-empty, not start with "." or end with ".lock"',
    ],
    ["a/", 'each part between slashes must be non-empty, not start with "." or end with ".lock"'],
    ["a.", 'must not end with "."'],
    ["x".repeat(251), "must be at most 250 characters"],
  ])("refuses %j: %s", (raw, problem) => {
    const parsed = branchName(raw);
    expect(parsed.ok ? null : parsed.error.issues[0]?.message).toBe(problem);
  });
});

const line = (...fields: string[]) => fields.join("\0");

describe("parseBranches", () => {
  test("local and remote branches, with tracking, and symbolic refs left out", () => {
    const output = [
      line("refs/heads/main", "*", "", "origin/main", "ahead 2, behind 1", "1791622028", "Fix"),
      line("refs/heads/old", " ", "", "origin/old", "gone", "1791620000", "Old"),
      line("refs/heads/solo", " ", "", "", "", "1791610000", "Solo"),
      line("refs/remotes/origin/HEAD", " ", "refs/remotes/origin/main", "", "", "1", "x"),
      line("refs/remotes/origin/feat/x", " ", "", "", "", "1791600000", "Feat"),
      "",
    ].join("\n");
    expect(parseBranches(output)).toEqual(
      ok([
        {
          name: "main",
          remote: null,
          current: true,
          upstream: "origin/main",
          ahead: 2,
          behind: 1,
          gone: false,
          committedAt: 1_791_622_028_000,
          subject: "Fix",
        },
        {
          name: "old",
          remote: null,
          current: false,
          upstream: "origin/old",
          ahead: 0,
          behind: 0,
          gone: true,
          committedAt: 1_791_620_000_000,
          subject: "Old",
        },
        {
          name: "solo",
          remote: null,
          current: false,
          upstream: null,
          ahead: 0,
          behind: 0,
          gone: false,
          committedAt: 1_791_610_000_000,
          subject: "Solo",
        },
        {
          name: "origin/feat/x",
          remote: "origin",
          current: false,
          upstream: null,
          ahead: 0,
          behind: 0,
          gone: false,
          committedAt: 1_791_600_000_000,
          subject: "Feat",
        },
      ]),
    );
  });

  test.each([["refs/heads/main\0*"], [line("refs/tags/v1", " ", "", "", "", "1", "Tag")]])(
    "refuses what it cannot read: %j",
    (output) => {
      const parsed = parseBranches(output);
      expect(parsed.ok ? null : parsed.error.message).toBe("Unexpected git for-each-ref output");
    },
  );
});
