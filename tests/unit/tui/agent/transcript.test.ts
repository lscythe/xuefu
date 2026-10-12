import { describe, expect, test } from "bun:test";
import { toolLine, transcriptRows } from "../../../../src/tui/agent/transcript";

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
  test("your messages marked, answers as written, notes and tool steps dim and together", () => {
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
      "/w",
      false,
    );
    expect(rows).toEqual([
      { text: "› Review MOB/app#42", tone: "accentSecondary" },
      { text: "  for me please", tone: "accentSecondary" },
      { text: "", tone: "text" },
      // Exactly the width; a longer step wraps under itself.
      { text: "↳ pr diff MOB/app#42", tone: "textMuted" },
      { text: "↳ pr comments", tone: "textMuted" },
      { text: "   MOB/app#42", tone: "textMuted" },
      { text: "↳ Read Login.kt", tone: "textMuted" },
      { text: "", tone: "text" },
      { text: "Looks good.", tone: "text" },
      { text: "", tone: "text" },
      { text: "One risk: the PIN", tone: "text" },
      { text: "fallback.", tone: "text" },
      { text: "", tone: "text" },
      { text: "Claude stopped", tone: "error" },
      { text: "aside", tone: "textMuted" },
    ]);
  });

  test("plain markers without Nerd Font glyphs", () => {
    const rows = transcriptRows(
      [
        { kind: "you", text: "hi" },
        { kind: "tool", name: "pr_list", input: {} },
      ],
      40,
      "/w",
      true,
    );
    expect(rows.map((row) => row.text)).toEqual(["> hi", "", "-> pr list"]);
  });
});
