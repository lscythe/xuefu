import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import { cycle } from "../../../src/tui/list-navigation";

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
