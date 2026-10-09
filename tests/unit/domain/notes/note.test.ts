import { describe, expect, test } from "bun:test";
import { appendToNote, type NoteBody, noteBody } from "../../../../src/domain/notes/note";

const body = (raw: string): NoteBody => {
  const parsed = noteBody(raw);
  if (!parsed.ok || parsed.value === null) throw new Error(`not a body: ${raw}`);
  return parsed.value;
};

describe("noteBody", () => {
  test("keeps the text, with Windows and old Mac line endings made plain", () => {
    expect(noteBody("Ask QA about\r\nthe flaky test\rtomorrow")).toEqual({
      ok: true,
      value: "Ask QA about\nthe flaky test\ntomorrow" as NoteBody,
    });
    expect(noteBody("  indented\n\tand tabbed").ok).toBe(true);
    expect(noteBody("指纹登录 🔐").ok).toBe(true);
  });

  test("drops blank lines before and whitespace after the text", () => {
    expect(noteBody("\n\n  first\nlast  \n\n")).toEqual({
      ok: true,
      value: "  first\nlast" as NoteBody,
    });
  });

  test("blank text means no note", () => {
    expect(noteBody("")).toEqual({ ok: true, value: null });
    expect(noteBody(" \n\t\r\n")).toEqual({ ok: true, value: null });
  });

  test("refuses control characters and text past the limit", () => {
    expect(noteBody("bell\u0007")).toMatchObject({
      ok: false,
      error: { issues: [{ message: "must not contain control characters other than tabs" }] },
    });
    expect(noteBody("x".repeat(20_000)).ok).toBe(true);
    expect(noteBody("x".repeat(20_001))).toMatchObject({
      ok: false,
      error: { issues: [{ message: "must be at most 20000 characters" }] },
    });
  });
});

describe("appendToNote", () => {
  test("adds the text on a line of its own", () => {
    expect(appendToNote(body("first"), body("second"))).toEqual({
      ok: true,
      value: "first\nsecond" as NoteBody,
    });
    expect(appendToNote(null, body("only"))).toEqual({ ok: true, value: "only" as NoteBody });
  });

  test("the limit applies to the whole note", () => {
    expect(appendToNote(body("x".repeat(19_999)), body("yy")).ok).toBe(false);
  });
});
