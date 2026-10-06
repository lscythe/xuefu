import { describe, expect, test } from "bun:test";
import { fitsTerminal, MIN_COLUMNS, MIN_ROWS } from "../../../../src/tui/shell/terminal-size";

describe("fitsTerminal", () => {
  test("80×24 is the smallest supported terminal", () => {
    expect([MIN_COLUMNS, MIN_ROWS]).toEqual([80, 24]);
    expect(fitsTerminal(80, 24)).toBe(true);
    expect(fitsTerminal(200, 60)).toBe(true);
  });

  test.each([
    [79, 24],
    [80, 23],
    [0, 0],
  ])("%i×%i is too small", (width, height) => {
    expect(fitsTerminal(width, height)).toBe(false);
  });
});
