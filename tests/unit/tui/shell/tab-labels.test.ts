import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import { fitTabLabels, truncateToWidth } from "../../../../src/tui/shell/tab-labels";

const cellsWidth = (labels: readonly string[]) =>
  labels.reduce((sum, label, i) => sum + Bun.stringWidth(` ${i + 1} ${label} `), 0);

describe("truncateToWidth", () => {
  test.each([
    ["Mobile Banking", 20, "Mobile Banking"],
    ["Mobile Banking", 8, "Mobile …"],
    ["Mobile Banking", 1, "…"],
    ["血符 App", 4, "血…"],
    ["血符 App", 3, "血…"],
  ])("%p in %i columns → %p", (text, width, expected) => {
    expect(truncateToWidth(text, width)).toBe(expected);
    expect(Bun.stringWidth(truncateToWidth(text, width))).toBeLessThanOrEqual(width);
  });
});

describe("fitTabLabels", () => {
  test("keeps names whole when they fit", () => {
    expect(fitTabLabels(["Mobile Banking", "deployd"], 80)).toEqual(["Mobile Banking", "deployd"]);
  });

  test("shortens the longest names first", () => {
    const fitted = fitTabLabels(["Mobile Banking Platform", "api", "Payments Gateway"], 40);
    expect(fitted[1]).toBe("api");
    expect(cellsWidth(fitted)).toBeLessThanOrEqual(40);
    expect(fitted[0]?.endsWith("…")).toBe(true);
  });

  test("property: the tab bar never overflows when it can fit at all", () => {
    fc.assert(
      fc.property(
        fc.array(fc.string({ minLength: 1, maxLength: 30 }), { minLength: 1, maxLength: 9 }),
        fc.integer({ min: 0, max: 200 }),
        (names, width) => {
          const fitted = fitTabLabels(names, width);
          expect(fitted).toHaveLength(names.length);
          const minimum = names.reduce((sum, _, i) => sum + Bun.stringWidth(` ${i + 1} … `), 0);
          if (width >= minimum) expect(cellsWidth(fitted)).toBeLessThanOrEqual(width);
        },
      ),
    );
  });
});
