import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import { segments } from "../../../src/tui/highlight";

describe("segments", () => {
  test("merges adjacent hits and plain runs", () => {
    expect(segments("mobile-banking", [0, 1, 7])).toEqual([
      { text: "mo", hit: true },
      { text: "bile-", hit: false },
      { text: "b", hit: true },
      { text: "anking", hit: false },
    ]);
  });

  test("no hits is one plain segment; empty text is none", () => {
    expect(segments("deployd", [])).toEqual([{ text: "deployd", hit: false }]);
    expect(segments("", [])).toEqual([]);
  });

  test("positions are code points", () => {
    expect(segments("血符 App", [1])).toEqual([
      { text: "血", hit: false },
      { text: "符", hit: true },
      { text: " App", hit: false },
    ]);
  });

  test("property: segments rebuild the text and alternate", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 20 }), fc.array(fc.nat(25)), (text, hits) => {
        const parts = segments(text, hits);
        expect(parts.map((p) => p.text).join("")).toBe(text);
        for (let i = 1; i < parts.length; i++) {
          expect(parts[i]?.hit).not.toBe(parts[i - 1]?.hit);
        }
      }),
    );
  });
});
