import { describe, expect, test } from "bun:test";
import type { PullRequestComment } from "../../../../src/plugins/pr/domain/comment";
import { parseDiff } from "../../../../src/plugins/pr/domain/diff";
import { type ReviewRow, reviewRows, selectable } from "../../../../src/plugins/pr/tui/review-rows";
import { sampleDiff } from "../../../support/fake-pull-requests";

const FILES = parseDiff(sampleDiff({ id: 42 }));

const comment = (id: number, extra: Partial<PullRequestComment> = {}): PullRequestComment => ({
  id,
  version: 0,
  author: "Fox Mulder",
  text: `Comment ${id}`,
  created: 0,
  updated: 0,
  anchor: null,
  todo: null,
  resolved: false,
  replies: [],
  ...extra,
});

/** Each row in a few words, to read the layout at a glance. */
function outline(rows: readonly ReviewRow[]): string[] {
  return rows.map((row) => {
    switch (row.kind) {
      case "heading":
        return `# ${row.text}`;
      case "file":
        return `file ${row.file.to ?? row.file.from}`;
      case "hunk":
        return row.header;
      case "line":
        return `${row.line.kind} ${row.anchor.side}:${row.anchor.line}`;
      case "comment":
        return `${"  ".repeat(row.depth)}comment #${row.comment.id} in #${row.thread}`;
      case "text":
        return `${"  ".repeat(row.depth)}| ${row.text}`;
      case "blank":
        return "";
      default:
        return "?";
    }
  });
}

describe("reviewRows", () => {
  test("the diff alone: each file, its hunks and their lines, each with where a comment goes", () => {
    expect(outline(reviewRows(FILES, [], 80))).toEqual([
      "file app/src/Login.kt",
      "@@ -10,3 +10,4 @@ class Login {",
      "context new:10",
      "removed old:11",
      "added new:11",
      "added new:12",
      "context new:13",
      "",
      "file docs/login.md",
      "@@ -0,0 +1,2 @@",
      "added new:1",
      "added new:2",
      "",
    ]);
  });

  test("threads go under their line, on the file, on the whole, or last when outdated", () => {
    const on = (path: string, line: number | null, side: "old" | "new", outdated = false) => ({
      path,
      line,
      side,
      lineKind: null,
      outdated,
    });
    const rows = reviewRows(
      FILES,
      [
        comment(1, { text: "Looks good." }),
        comment(2, {
          anchor: on("app/src/Login.kt", 11, "new"),
          replies: [comment(3, { replies: [comment(4)] })],
        }),
        comment(5, { anchor: on("app/src/Login.kt", 11, "old") }),
        comment(6, { anchor: on("docs/login.md", null, "new") }),
        comment(7, { anchor: on("app/src/Login.kt", 11, "new", true) }),
        comment(8, { anchor: on("gone.kt", 3, "new") }),
      ],
      80,
    );
    expect(outline(rows)).toEqual([
      "# On the pull request",
      "comment #1 in #1",
      "| Looks good.",
      "",
      "file app/src/Login.kt",
      "@@ -10,3 +10,4 @@ class Login {",
      "context new:10",
      "removed old:11",
      "comment #5 in #5",
      "| Comment 5",
      "added new:11",
      "comment #2 in #2",
      "| Comment 2",
      "  comment #3 in #2",
      "  | Comment 3",
      "    comment #4 in #2",
      "    | Comment 4",
      "added new:12",
      "context new:13",
      "",
      "file docs/login.md",
      "comment #6 in #6",
      "| Comment 6",
      "@@ -0,0 +1,2 @@",
      "added new:1",
      "added new:2",
      "",
      "# On code that has changed since",
      "comment #7 in #7",
      "| Comment 7",
      "",
      "comment #8 in #8",
      "| Comment 8",
      "",
    ]);
    expect(rows.filter(selectable)).toHaveLength(15);
  });

  test("a comment's text wraps to the width, past its indent", () => {
    const rows = reviewRows(
      [],
      [
        comment(1, {
          text: "one two three four five six",
          replies: [comment(2, { text: "seven eight nine" })],
        }),
      ],
      20,
    );
    // 16 columns are left past a thread's indent, 14 past a reply's.
    expect(outline(rows).filter((line) => line.includes("|"))).toEqual([
      "| one two three",
      "| four five six",
      "  | seven eight",
      "  | nine",
    ]);
  });
});
