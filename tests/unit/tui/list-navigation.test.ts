import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import { cycle, scrollOffset } from "../../../src/tui/list-navigation";

describe("cycle", () => {
  test("wraps at both ends", () => {
    expect(cycle(0, -1, 10)).toBe(9);
    expect(cycle(9, 1, 10)).toBe(0);
    expect(cycle(3, 1, 10)).toBe(4);
  });

  test("property: always lands inside the list", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 50 }),
        fc.nat(),
        fc.integer({ min: -100, max: 100 }),
        (count, start, delta) => {
          const next = cycle(start % count, delta, count);
          expect(next).toBeGreaterThanOrEqual(0);
          expect(next).toBeLessThan(count);
        },
      ),
    );
  });
});

describe("scrollOffset", () => {
  test("no scrolling when everything fits", () => {
    expect(scrollOffset(4, 5, 10)).toBe(0);
  });

  test("keeps the selection near the middle and stops at the ends", () => {
    expect(scrollOffset(0, 30, 10)).toBe(0);
    expect(scrollOffset(15, 30, 10)).toBe(10);
    expect(scrollOffset(29, 30, 10)).toBe(20);
  });

  test("property: the selected row is always visible", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 200 }), fc.integer({ min: 1, max: 40 }), (rows, h) => {
        for (const selected of [0, Math.floor(rows / 2), rows - 1]) {
          const offset = scrollOffset(selected, rows, h);
          expect(offset).toBeGreaterThanOrEqual(0);
          expect(selected).toBeGreaterThanOrEqual(offset);
          expect(selected).toBeLessThan(offset + h);
        }
      }),
    );
  });
});
