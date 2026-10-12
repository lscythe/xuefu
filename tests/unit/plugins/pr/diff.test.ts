import { describe, expect, test } from "bun:test";
import { filePath, parseDiff } from "../../../../src/plugins/pr/domain/diff";

const MODIFIED = [
  "diff --git a/app/src/Login.kt b/app/src/Login.kt",
  "index 3b18e51..a2c4f0d 100644",
  "--- a/app/src/Login.kt",
  "+++ b/app/src/Login.kt",
  "@@ -10,3 +10,4 @@ class Login {",
  "     fun start() {",
  "-        pin()",
  "+        if (biometrics) prompt()",
  "+        else pin()",
  "     }",
  "@@ -40 +41 @@ fun pin() {",
  "--- the old banner",
  "+-- the new banner",
  "\\ No newline at end of file",
].join("\n");

describe("parseDiff", () => {
  test("a changed file's hunks, each line with its numbers before and after", () => {
    const [file] = parseDiff(MODIFIED);
    expect(file).toMatchObject({
      from: "app/src/Login.kt",
      to: "app/src/Login.kt",
      change: "modified",
      binary: false,
      added: 3,
      removed: 2,
    });
    expect(file?.hunks[0]).toEqual({
      header: "@@ -10,3 +10,4 @@ class Login {",
      lines: [
        { kind: "context", text: "    fun start() {", old: 10, new: 10 },
        { kind: "removed", text: "        pin()", old: 11, new: null },
        { kind: "added", text: "        if (biometrics) prompt()", old: null, new: 11 },
        { kind: "added", text: "        else pin()", old: null, new: 12 },
        { kind: "context", text: "    }", old: 12, new: 13 },
      ],
    });
  });

  test("a hunk takes the lines its heading counts, even ones that look like headings", () => {
    const [file] = parseDiff(MODIFIED);
    expect(file?.hunks[1]?.lines).toEqual([
      { kind: "removed", text: "-- the old banner", old: 40, new: null },
      { kind: "added", text: "-- the new banner", old: null, new: 41 },
    ]);
    expect(parseDiff(MODIFIED)).toHaveLength(1);
  });

  test("files added, deleted, renamed and binary", () => {
    const files = parseDiff(
      [
        "diff --git a/README.md b/README.md",
        "new file mode 100644",
        "index 0000000..e69de29",
        "--- /dev/null",
        "+++ b/README.md",
        "@@ -0,0 +1 @@",
        "+# Mobile",
        "diff --git a/old.txt b/old.txt",
        "deleted file mode 100644",
        "--- a/old.txt",
        "+++ /dev/null",
        "@@ -1 +0,0 @@",
        "-gone",
        "diff --git a/src/A.kt b/src/B.kt",
        "similarity index 100%",
        "rename from src/A.kt",
        "rename to src/B.kt",
        "diff --git a/logo.png b/logo.png",
        "Binary files a/logo.png and b/logo.png differ",
        "",
      ].join("\n"),
    );
    expect(files.map((file) => [file.from, file.to, file.change, file.binary])).toEqual([
      [null, "README.md", "added", false],
      ["old.txt", null, "deleted", false],
      ["src/A.kt", "src/B.kt", "renamed", false],
      ["logo.png", "logo.png", "modified", true],
    ]);
    expect(files.map(filePath)).toEqual(["README.md", "old.txt", "src/B.kt", "logo.png"]);
    expect(files[0]?.hunks[0]?.lines).toEqual([
      { kind: "added", text: "# Mobile", old: null, new: 1 },
    ]);
  });

  test("a diff without git's headings, quoted paths, and none at all", () => {
    const [plain] = parseDiff(
      ["--- a/x y.txt\t2026-10-01", "+++ b/x y.txt", "@@ -1 +1 @@", "-a", "+b"].join("\n"),
    );
    expect(plain).toMatchObject({ from: "x y.txt", to: "x y.txt", added: 1, removed: 1 });
    const [quoted] = parseDiff(
      [
        'diff --git "a/caf\\"e.txt" "b/caf\\"e.txt"',
        '--- "a/caf\\"e.txt"',
        '+++ "b/caf\\"e.txt"',
      ].join("\n"),
    );
    expect(quoted?.to).toBe('caf"e.txt');
    expect(parseDiff("")).toEqual([]);
  });

  test("an empty line inside a hunk is context, as some tools strip its space", () => {
    const [file] = parseDiff(
      ["--- a/f", "+++ b/f", "@@ -1,3 +1,3 @@", " a", "", "-b", "+c"].join("\n"),
    );
    expect(file?.hunks[0]?.lines.map((line) => [line.kind, line.old, line.new])).toEqual([
      ["context", 1, 1],
      ["context", 2, 2],
      ["removed", 3, null],
      ["added", null, 3],
    ]);
  });
});
