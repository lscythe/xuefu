import { describe, expect, test } from "bun:test";
import { ok } from "../../../../src/domain/shared/result";
import {
  type Branch,
  branchChoices,
  branchName,
  localName,
  parseBranches,
} from "../../../../src/plugins/git/domain/branches";
import { branchRows } from "../../../../src/plugins/git/tui/branch-picker";

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

const branch = (name: string, extra: Partial<Branch> = {}): Branch => ({
  name,
  remote: null,
  current: false,
  upstream: null,
  ahead: 0,
  behind: 0,
  gone: false,
  committedAt: 0,
  subject: "",
  ...extra,
});

describe("branchChoices", () => {
  test("local branches, then remote ones nothing here tracks or shares a name with", () => {
    const remote = (name: string) => branch(name, { remote: name.split("/")[0] ?? null });
    const choices = branchChoices([
      branch("main", { upstream: "origin/main" }),
      remote("origin/main"),
      branch("renamed", { upstream: "origin/old-name" }),
      remote("origin/old-name"),
      branch("feat"),
      remote("origin/feat"),
      remote("origin/new/thing"),
    ]);
    expect(choices.map((choice) => choice.name)).toEqual([
      "main",
      "renamed",
      "feat",
      "origin/new/thing",
    ]);
    expect(localName(choices[3] as Branch)).toBe("new/thing");
    expect(localName(choices[0] as Branch)).toBe("main");
  });
});

describe("branchRows", () => {
  const rows = (query: string) =>
    branchRows(
      [
        branch("main", { current: true, upstream: "origin/main" }),
        branch("feat/login"),
        branch("origin/main", { remote: "origin" }),
        branch("origin/release", { remote: "origin" }),
      ],
      query,
    ).map((row) =>
      row.kind === "heading"
        ? `# ${row.label}`
        : row.kind === "create"
          ? `+ ${row.name}`
          : row.branch.name,
    );

  test("blank: local branches, then remote ones, under headings", () => {
    expect(rows("")).toEqual(["# Local", "main", "feat/login", "# Remote", "origin/release"]);
  });

  test("a query keeps the matches, best first, then offers to create it", () => {
    expect(rows("login")).toEqual(["feat/login", "+ login"]);
    expect(rows("rel")).toEqual(["origin/release", "+ rel"]);
  });

  test("no create row for a name taken here, or one git refuses", () => {
    expect(rows("main")).toEqual(["main"]);
    expect(rows("bad name")).toEqual([]);
  });
});
