import { describe, expect, test } from "bun:test";
import { bigClockRows, fitClock } from "../../../src/tui/big-clock";

describe("bigClockRows", () => {
  test("large digits are five rows, each pixel two cells wide", () => {
    expect(bigClockRows("10", "large")).toEqual([
      "████   ██████",
      "  ██   ██  ██",
      "  ██   ██  ██",
      "  ██   ██  ██",
      "██████ ██████",
    ]);
  });

  test("small digits fold two pixel rows into one with half blocks", () => {
    expect(bigClockRows("0:1", "small")).toEqual(["█▀█ ▄ ▀█ ", "█ █ ▄  █ ", "▀▀▀   ▀▀▀"]);
  });

  test("anything but a digit or colon is left blank", () => {
    expect(bigClockRows("-", "small")).toEqual(["   ", "   ", "   "]);
  });
});

describe("fitClock", () => {
  test("is as large as the space allows, and null when even small does not fit", () => {
    expect(fitClock("01:42:18", 47, 5)).toBe("large");
    expect(fitClock("01:42:18", 46, 5)).toBe("small");
    expect(fitClock("01:42:18", 80, 4)).toBe("small");
    expect(fitClock("01:42:18", 26, 9)).toBeNull();
    expect(fitClock("01:42:18", 80, 2)).toBeNull();
  });
});
