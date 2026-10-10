import { describe, expect, test } from "bun:test";
import {
  changeLetter,
  type FileChange,
  isClean,
  parseStatus,
  stagedFiles,
  unstagedFiles,
} from "../../../../src/plugins/git/domain/status";

/** Records as git prints them with -z: each ends in NUL. */
const z = (...records: string[]) => records.map((record) => `${record}\0`).join("");

const HEADERS = [
  "# branch.oid 1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b",
  "# branch.head main",
  "# branch.upstream origin/main",
  "# branch.ab +2 -1",
];
const MODES = "N... 100644 100644 100644 1111111 2222222";

describe("parseStatus", () => {
  test("reads the branch, its upstream and how far apart they are", () => {
    const parsed = parseStatus(z(...HEADERS, "# stash 3"));
    expect(parsed.ok && parsed.value).toEqual({
      branch: "main",
      commit: "1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b",
      upstream: "origin/main",
      ahead: 2,
      behind: 1,
      changes: [],
      conflicts: [],
      untracked: [],
      stashes: 3,
    });
  });

  test("a detached HEAD has no branch; a new repository has no commit or upstream", () => {
    const detached = parseStatus(z("# branch.oid abc", "# branch.head (detached)"));
    expect(detached.ok && detached.value).toMatchObject({ branch: null, commit: "abc" });
    const fresh = parseStatus(z("# branch.oid (initial)", "# branch.head main"));
    expect(fresh.ok && fresh.value).toMatchObject({
      branch: "main",
      commit: null,
      upstream: null,
      ahead: 0,
      behind: 0,
    });
  });

  test("reads staged and unstaged changes, keeping spaces in paths", () => {
    const parsed = parseStatus(
      z(
        ...HEADERS,
        `1 M. ${MODES} src/app.ts`,
        `1 .M ${MODES} docs/read me.md`,
        `1 AD ${MODES} gone soon.txt`,
        `1 .T ${MODES} link`,
      ),
    );
    if (!parsed.ok) throw new Error(parsed.error.message);
    expect(parsed.value.changes).toEqual([
      { path: "src/app.ts", from: null, staged: "modified", unstaged: "unchanged" },
      { path: "docs/read me.md", from: null, staged: "unchanged", unstaged: "modified" },
      { path: "gone soon.txt", from: null, staged: "added", unstaged: "deleted" },
      { path: "link", from: null, staged: "unchanged", unstaged: "type-changed" },
    ]);
    expect(stagedFiles(parsed.value).map((f) => f.path)).toEqual(["src/app.ts", "gone soon.txt"]);
    expect(unstagedFiles(parsed.value).map((f) => f.path)).toEqual([
      "docs/read me.md",
      "gone soon.txt",
      "link",
    ]);
  });

  test("a rename or copy carries its source in the next record", () => {
    const parsed = parseStatus(
      z(
        ...HEADERS,
        `2 R. ${MODES} R100 new name.ts`,
        "old name.ts",
        `2 C. ${MODES} C75 b.ts`,
        "a.ts",
      ),
    );
    expect(parsed.ok && parsed.value.changes).toEqual([
      { path: "new name.ts", from: "old name.ts", staged: "renamed", unstaged: "unchanged" },
      { path: "b.ts", from: "a.ts", staged: "copied", unstaged: "unchanged" },
    ]);
  });

  test("reads conflicts and untracked files, and skips ignored ones", () => {
    const parsed = parseStatus(
      z(
        ...HEADERS,
        "u UU N... 100644 100644 100644 100644 1111111 2222222 3333333 merge me.ts",
        "? new file.txt",
        "! dist/",
      ),
    );
    expect(parsed.ok && parsed.value).toMatchObject({
      conflicts: ["merge me.ts"],
      untracked: ["new file.txt"],
      changes: [],
    });
  });

  test("a clean tree has nothing to list; any change, conflict or new file makes it dirty", () => {
    const clean = parseStatus(z(...HEADERS));
    expect(clean.ok && isClean(clean.value)).toBe(true);
    for (const entry of [`1 .M ${MODES} a`, "? b", `u UU ${MODES} 3333333 c`]) {
      const dirty = parseStatus(z(...HEADERS, entry));
      expect(dirty.ok && isClean(dirty.value)).toBe(false);
    }
  });

  test("skips headers it does not know, as git may add more", () => {
    const parsed = parseStatus(z("# branch.head main", "# something.new 42"));
    expect(parsed.ok && parsed.value.branch).toBe("main");
  });

  test.each([
    ["an unknown entry", z("X what is this")],
    ["an incomplete entry", z("1 .M N...")],
    ["unknown change letters", z(`1 ?? ${MODES} a`)],
    ["a rename without its source", z(`2 R. ${MODES} R100 b`)],
    ["unreadable ahead and behind", z("# branch.ab ahead")],
  ])("rejects %s", (_label, output) => {
    const parsed = parseStatus(output);
    expect(!parsed.ok && parsed.error.kind).toBe("validation");
  });
});

describe("changeLetter", () => {
  test.each([
    ["unchanged", " "],
    ["modified", "M"],
    ["type-changed", "T"],
    ["added", "A"],
    ["deleted", "D"],
    ["renamed", "R"],
    ["copied", "C"],
  ] as [FileChange, string][])("%s is %j", (change, letter) => {
    expect(changeLetter(change)).toBe(letter);
  });
});
