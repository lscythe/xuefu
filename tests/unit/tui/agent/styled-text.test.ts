import { describe, expect, test } from "bun:test";
import {
  inlineSpans,
  markdownLines,
  type StyledLine,
  wrapSpans,
} from "../../../../src/tui/agent/styled-text";

const plain = (rows: readonly StyledLine[]) =>
  rows.map((row) => row.map((span) => span.text).join(""));

describe("inlineSpans", () => {
  test("links retain their label and destination, with emphasis rendered", () => {
    expect(inlineSpans("See [design](https://example.test/design) and *retry*.", "text")).toEqual([
      { tone: "text", text: "See " },
      { tone: "accentSecondary", text: "design (https://example.test/design)" },
      { tone: "text", text: " and " },
      { tone: "text", italic: true, text: "retry" },
      { tone: "text", text: "." },
    ]);
  });
  test("code, bold, and a file and line stand out of the text around them", () => {
    expect(
      inlineSpans("Await `authenticate()` in **Login.kt** at app/src/Login.kt:11.", "text"),
    ).toEqual([
      { tone: "text", text: "Await " },
      { tone: "accentSpectral", text: "authenticate()" },
      { tone: "text", text: " in " },
      { tone: "text", bold: true, text: "Login.kt" },
      { tone: "text", text: " at " },
      { tone: "accentSecondary", text: "app/src/Login.kt:11" },
      { tone: "text", text: "." },
    ]);
    expect(inlineSpans("lines Pin.kt:4-9 and __this__", "textMuted")).toEqual([
      { tone: "textMuted", text: "lines " },
      { tone: "accentSecondary", text: "Pin.kt:4-9" },
      { tone: "textMuted", text: " and " },
      { tone: "textMuted", bold: true, text: "this" },
    ]);
    expect(inlineSpans("", "text")).toEqual([]);
  });
});

describe("wrapSpans", () => {
  test("breaks at spaces, keeping each word's style across the break, after the markers", () => {
    const lines = wrapSpans(
      [
        { text: "call ", tone: "text" },
        { text: "authenticate()", tone: "accentSpectral" },
        { text: " first", tone: "text" },
      ],
      16,
      [{ text: "● ", tone: "accentTertiary" }],
      [{ text: "  ", tone: "text" }],
    );
    expect(lines).toEqual([
      [
        { text: "● ", tone: "accentTertiary" },
        { text: "call", tone: "text" },
      ],
      [
        { text: "  ", tone: "text" },
        { text: "authenticate()", tone: "accentSpectral" },
      ],
      // Runs of one style are drawn as one.
      [{ text: "  first", tone: "text" }],
    ]);
  });

  test("a word longer than a line is cut; nothing at all is the markers alone", () => {
    expect(plain(wrapSpans([{ text: "abcdefghij", tone: "text" }], 4))).toEqual([
      "abcd",
      "efgh",
      "ij",
    ]);
    expect(plain(wrapSpans([{ text: "符符符", tone: "text" }], 4))).toEqual(["符符", "符"]);
    expect(wrapSpans([], 10, [{ text: "› ", tone: "text" }])).toEqual([
      [{ text: "› ", tone: "text" }],
    ]);
  });
});

describe("markdownLines", () => {
  test("headings, lists, quotes, rules and paragraphs, drawn rather than shown", () => {
    const lines = markdownLines(
      [
        "## Findings",
        "",
        "1. The prompt is not awaited before it signs in.",
        "- a bullet",
        "  * nested",
        "> a quote",
        "---",
        "  indented text",
      ].join("\n"),
      24,
      false,
    );
    expect(plain(lines)).toEqual([
      "Findings",
      "",
      "1. The prompt is not",
      "   awaited before it",
      "   signs in.",
      "• a bullet",
      "  • nested",
      "▎ a quote",
      "─".repeat(24),
      "  indented text",
    ]);
    expect(lines[0]?.[0]).toMatchObject({ bold: true });
    expect(lines[2]?.[0]).toMatchObject({ text: "1. ", tone: "accentTertiary", bold: true });
    expect(lines[7]?.[1]).toMatchObject({ tone: "textMuted", italic: true });
  });

  test("code is fenced off, keeps its spaces, is cut rather than wrapped, and a diff is coloured", () => {
    const lines = markdownLines(
      [
        "```kotlin",
        "@@ -1 +1 @@",
        "-  prompt()",
        "+  authenticate().await()",
        "",
        "  val x = 1",
        "```",
      ].join("\n"),
      14,
      false,
    );
    expect(plain(lines)).toEqual([
      "▎ @@ -1 +1 @@",
      "▎ -  prompt()",
      "▎ +  authentic",
      "▎ ate().await(",
      "▎ )",
      "▎  ",
      "▎   val x = 1",
    ]);
    expect(lines.map((line) => line[1]?.tone)).toEqual([
      "accentSecondary",
      "error",
      "success",
      "success",
      "success",
      "text",
      "text",
    ]);
  });

  test("plain markers without Nerd Font glyphs", () => {
    expect(plain(markdownLines("- a\n> b\n***\n```\nc\n```", 6, true))).toEqual([
      "- a",
      "| b",
      "------",
      "| c",
    ]);
  });
});
