import { describe, expect, test } from "bun:test";
import {
  filePath,
  parseDiff,
  placeComment,
  placementProblem,
} from "../../../../src/plugins/pr/domain/diff";

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

describe("placeComment", () => {
  /** Two modules with a file of the same name, and one moved. */
  const FILES = parseDiff(
    [
      "diff --git a/feature/detail/src/main/java/id/bri/detail/DetailViewModel.kt b/feature/detail/src/main/java/id/bri/detail/DetailViewModel.kt",
      "@@ -280,3 +280,5 @@",
      "         try {",
      "-            pin()",
      "+            cvv()",
      "+        } catch (e: Throwable) {",
      "+            error(e)",
      "         }",
      "diff --git a/feature/addcc/src/main/java/id/bri/addcc/Screen.kt b/feature/addcc/src/main/java/id/bri/addcc/Screen.kt",
      "@@ -1 +1 @@",
      "-a",
      "+b",
      "diff --git a/feature/estatement/src/main/java/id/bri/Screen.kt b/feature/estatement/src/main/java/id/bri/Screen.kt",
      "@@ -1 +1 @@",
      "-a",
      "+b",
      "diff --git a/core/Old.kt b/core/New.kt",
      "rename from core/Old.kt",
      "rename to core/New.kt",
      "@@ -5 +5 @@",
      "-x",
      "+y",
    ].join("\n"),
  );
  const DETAIL = "feature/detail/src/main/java/id/bri/detail/DetailViewModel.kt";

  test("on a line the diff shows, by the path as the diff has it, or as it was before a move", () => {
    expect(placeComment(FILES, DETAIL, 282, "new")).toEqual({
      kind: "placed",
      anchor: { path: DETAIL, line: 282, side: "new", lineKind: "added" },
    });
    expect(placeComment(FILES, DETAIL, 284, "new")).toMatchObject({
      anchor: { lineKind: "context" },
    });
    expect(placeComment(FILES, DETAIL, 281, "old")).toMatchObject({
      anchor: { side: "old", lineKind: "removed" },
    });
    expect(placeComment(FILES, "core/Old.kt", 5, "new")).toMatchObject({
      anchor: { path: "core/New.kt" },
    });
  });

  test("a path cut short is the one file it fits", () => {
    for (const short of [
      "feature/detail/ui/detail/DetailViewModel.kt".replace("ui/detail/", "detail/"),
      "feature/detail/DetailViewModel.kt",
      "feature/…/DetailViewModel.kt",
      ".../detail/DetailViewModel.kt",
      "DetailViewModel.kt",
    ]) {
      expect(placeComment(FILES, short, 282, "new")).toMatchObject({ anchor: { path: DETAIL } });
    }
    expect(placeComment(FILES, "addcc/Screen.kt", 1, "new")).toMatchObject({
      anchor: { path: "feature/addcc/src/main/java/id/bri/addcc/Screen.kt" },
    });
  });

  test("one it does not fit, or fits more than one of, says which it could be", () => {
    const wrong = placeComment(FILES, "feature/detail/ui/DetailViewModel.kt", 282, "new");
    expect(wrong).toEqual({ kind: "no-file", near: [DETAIL] });
    if (wrong.kind !== "placed") {
      expect(
        placementProblem(wrong, "feature/detail/ui/DetailViewModel.kt", 282, "new", "--old"),
      ).toBe(`feature/detail/ui/DetailViewModel.kt is not in the diff; did you mean ${DETAIL}?`);
    }
    const none = placeComment(FILES, "Settings.kt", 1, "new");
    expect(none).toEqual({ kind: "no-file", near: [] });
    if (none.kind !== "placed") {
      expect(placementProblem(none, "Settings.kt", 1, "new", "--old")).toBe(
        "Settings.kt is not in the diff",
      );
    }
    const both = placeComment(FILES, "Screen.kt", 1, "new");
    expect(both.kind).toBe("ambiguous");
    if (both.kind !== "placed") {
      expect(placementProblem(both, "Screen.kt", 1, "new", "--old")).toBe(
        "Screen.kt could be feature/addcc/src/main/java/id/bri/addcc/Screen.kt or " +
          "feature/estatement/src/main/java/id/bri/Screen.kt; give its whole path",
      );
    }
  });

  test("a line it does not show says which lines it does", () => {
    const after = placeComment(FILES, DETAIL, 300, "new");
    expect(after).toEqual({ kind: "no-line", path: DETAIL, shown: "280-284", removed: "281" });
    if (after.kind === "no-line") {
      expect(placementProblem(after, DETAIL, 300, "new", "old: true")).toBe(
        `line 300 of ${DETAIL} is not in the diff, which shows lines 280-284 of it; ` +
          "for a removed line, add old: true",
      );
      expect(placementProblem(after, DETAIL, 280, "old", "--old")).toBe(
        `line 280 of ${DETAIL} as it was is not removed in the diff, which removes lines 281`,
      );
      expect(
        placementProblem({ ...after, shown: "", removed: "" }, DETAIL, 2, "old", "--old"),
      ).toBe(
        `line 2 of ${DETAIL} as it was is not removed in the diff, which removes nothing of it`,
      );
      expect(placementProblem({ ...after, shown: "" }, DETAIL, 2, "new", "--old")).toBe(
        `line 2 of ${DETAIL} is not in the diff; for a removed line, add --old`,
      );
    }
  });
});
