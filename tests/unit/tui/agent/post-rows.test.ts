import { describe, expect, test } from "bun:test";
import type { DraftComment } from "../../../../src/application/ports/agent";
import { commentPlace, postRows } from "../../../../src/tui/agent/post-rows";

const LOGIN: DraftComment = {
  file: "app/src/Login.kt",
  line: 11,
  old: false,
  text: "Await authenticate() before prompt().",
  suggestion: "authenticate().await()\nprompt()\n",
};
const PIN: DraftComment = {
  file: "Pin.kt",
  line: 4,
  old: true,
  text: "Why?",
  suggestion: "if (tries > 3) lock(forever = true)",
};

describe("commentPlace", () => {
  test("the file and line, or the old line of a removed one", () => {
    expect(commentPlace(LOGIN)).toBe("app/src/Login.kt:11");
    expect(commentPlace(PIN)).toBe("Pin.kt, old line 4");
  });
});

describe("postRows", () => {
  test("each comment's mark and place, its text, and the code it suggests", () => {
    const { rows, starts } = postRows([LOGIN, PIN], new Set([0]), 1, 30, false);
    expect(rows).toEqual([
      { text: "◉ 1. app/src/Login.kt:11", tone: "accentSecondary", current: false },
      { text: "  Await authenticate() before", tone: "text", current: false },
      { text: "  prompt().", tone: "text", current: false },
      { text: "  + authenticate().await()", tone: "success", current: false },
      { text: "  + prompt()", tone: "success", current: false },
      { text: "", tone: "text", current: false },
      // Left out, so dim; a removed line's code is not a change to the line.
      { text: "○ 2. Pin.kt, old line 4", tone: "textMuted", current: true },
      { text: "  Why?", tone: "textMuted", current: true },
      { text: "    if (tries > 3) lock(forev…", tone: "textMuted", current: true },
    ]);
    expect(starts).toEqual([0, 6]);
  });

  test("plain marks without Nerd Font glyphs; no code when none is suggested", () => {
    const { rows } = postRows([{ ...LOGIN, suggestion: null }], new Set([0]), 0, 60, true);
    expect(rows.map((row) => row.text)).toEqual([
      "[x] 1. app/src/Login.kt:11",
      "    Await authenticate() before prompt().",
    ]);
    expect(postRows([LOGIN], new Set(), 0, 60, true).rows[0]?.text).toBe(
      "[ ] 1. app/src/Login.kt:11",
    );
  });
});
