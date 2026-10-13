import { describe, expect, test } from "bun:test";
import type { StyledLine } from "../../../../src/tui/agent/styled-text";
import { toolLine, transcriptRows } from "../../../../src/tui/agent/transcript";

/** Each row as the text it shows. */
const plain = (rows: readonly StyledLine[]) =>
  rows.map((row) => row.map((span) => span.text).join(""));

/** The colour a row's text has where `text` starts. */
const toneAt = (row: StyledLine | undefined, text: string) => {
  let at = 0;
  const where = (row ?? [])
    .map((span) => span.text)
    .join("")
    .indexOf(text);
  for (const span of row ?? []) {
    if (where < at + span.text.length) return span.tone;
    at += span.text.length;
  }
  return null;
};

const OPTIONS = { cwd: "/w", ascii: false, thinking: false };

describe("toolLine", () => {
  test("the tool as a command, then what it was given, paths from the folder", () => {
    expect(toolLine("pr_diff", { pullRequest: "MOB/app#42", stat: true }, "/w")).toBe(
      "pr diff MOB/app#42",
    );
    expect(toolLine("Read", { file_path: "/w/app/src/Login.kt", limit: 40 }, "/w")).toBe(
      "Read app/src/Login.kt 40",
    );
    expect(toolLine("Grep", { pattern: "a\n b" }, "/w")).toBe("Grep a b");
    // Working in no folder, paths stay whole.
    expect(toolLine("Read", { file_path: "/w/Login.kt" }, null)).toBe("Read /w/Login.kt");
    const long = toolLine("pr_comment", { message: "x".repeat(200) }, "/w");
    expect(long).toHaveLength(80);
    expect(long.endsWith("…")).toBe(true);
  });
});

describe("transcriptRows", () => {
  test("your messages marked, answers after theirs, steps quieter and together", () => {
    const rows = transcriptRows(
      [
        { kind: "you", text: "Review MOB/app#42 for me please" },
        { kind: "tool", name: "pr_diff", input: { pullRequest: "MOB/app#42" } },
        { kind: "tool", name: "pr_comments", input: { pullRequest: "MOB/app#42" } },
        { kind: "tool", name: "Read", input: { file_path: "/w/Login.kt" } },
        { kind: "agent", text: "Looks good.\n\nOne risk: the PIN fallback." },
        { kind: "note", text: "Claude stopped", tone: "error" },
        { kind: "note", text: "aside", tone: "muted" },
      ],
      20,
      OPTIONS,
    );
    expect(plain(rows)).toEqual([
      "› Review MOB/app#42",
      "  for me please",
      "",
      // Exactly the width; a longer step wraps under itself.
      "↳ pr diff MOB/app#42",
      "↳ pr comments",
      "  MOB/app#42",
      "↳ Read Login.kt",
      "",
      "● Looks good.",
      "",
      "  One risk: the PIN",
      "  fallback.",
      "",
      "✗ Claude stopped",
      "· aside",
    ]);
    expect(toneAt(rows[0], "Review")).toBe("accentSecondary");
    // The tool's name stands out from what it was given.
    expect(toneAt(rows[3], "pr diff")).toBe("accentSecondary");
    expect(toneAt(rows[3], "MOB")).toBe("textMuted");
    expect(toneAt(rows[8], "●")).toBe("accentTertiary");
    expect(toneAt(rows[13], "Claude")).toBe("error");
    expect(toneAt(rows[14], "aside")).toBe("textMuted");
  });

  test("thinking is folded to its first lines, or shown whole", () => {
    const thinking = {
      kind: "thinking" as const,
      text: "First I read the diff.\nThen the comments.\nThen Login.kt.\nThen the tests.\nDone.",
    };
    const folded = transcriptRows([thinking], 40, OPTIONS);
    expect(plain(folded)).toEqual([
      "✻ First I read the diff.",
      "  Then the comments.",
      "  Then Login.kt.",
      "  … 2 more lines",
    ]);
    expect(folded[0]?.[1]).toMatchObject({ tone: "textMuted", italic: true });
    expect(plain(transcriptRows([thinking], 40, { ...OPTIONS, thinking: true }))).toHaveLength(5);
    const short = transcriptRows(
      [{ kind: "thinking", text: "One\nTwo\nThree\nFour" }],
      40,
      OPTIONS,
    );
    expect(plain(short).at(-1)).toBe("  … 1 more line");
  });

  test("plain markers without Nerd Font glyphs", () => {
    const rows = transcriptRows(
      [
        { kind: "you", text: "hi" },
        { kind: "tool", name: "pr_list", input: {} },
        { kind: "thinking", text: "a\nb\nc\nd" },
        { kind: "note", text: "failed", tone: "error" },
        { kind: "note", text: "fine", tone: "muted" },
        { kind: "agent", text: "- yes" },
      ],
      40,
      { ...OPTIONS, ascii: true },
    );
    expect(plain(rows)).toEqual([
      "> hi",
      "",
      "-> pr list",
      "~ a",
      "  b",
      "  c",
      "  ... 1 more line",
      "x failed",
      ". fine",
      "",
      "* - yes",
    ]);
  });
});
