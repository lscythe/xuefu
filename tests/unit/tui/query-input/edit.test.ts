import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import { eraseChar, eraseWord, pastedText } from "../../../../src/tui/query-input/edit";

describe("query editing", () => {
  test.each([
    ["mob", "mo"],
    ["", ""],
    ["血符", "血"],
    ["a😀", "a"],
  ])("eraseChar(%p) → %p", (query, expected) => {
    expect(eraseChar(query)).toBe(expected);
  });

  test.each([
    ["mobile bank", "mobile "],
    ["mobile bank  ", "mobile "],
    ["mobile-bank", "mobile-"],
    ["mobile-", "mobile"],
    ["mobile", ""],
    ["   ", ""],
    ["", ""],
  ])("eraseWord(%p) → %p", (query, expected) => {
    expect(eraseWord(query)).toBe(expected);
  });

  test("property: erasing a word always shortens a non-empty query", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 20 }), (query) => {
        expect(eraseWord(query).length).toBeLessThan(query.length);
        expect(query.startsWith(eraseWord(query))).toBe(true);
      }),
    );
  });
});

describe("pastedText", () => {
  test("pastes as one line without control characters", () => {
    expect(pastedText("mobile\n  bank\t\u0007")).toBe("mobile bank ");
  });
});
