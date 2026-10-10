import { describe, expect, test } from "bun:test";
import { fitHints } from "../../../../src/tui/shell/panel-status";

describe("fitHints", () => {
  const hints = [
    { text: "space stage", rank: 0 },
    { text: "a stage all", rank: 5 },
    { text: "c commit", rank: 1 },
    { text: "f fetch", rank: 6 },
  ];

  test("keeps every hint that fits, in order", () => {
    expect(fitHints(hints, 80, false)).toBe("space stage · a stage all · c commit · f fetch");
    expect(fitHints(hints, 80, true)).toBe("space stage | a stage all | c commit | f fetch");
  });

  test("gives up the least needed first when short of room", () => {
    expect(fitHints(hints, 36, false)).toBe("space stage · a stage all · c commit");
    expect(fitHints(hints, 24, false)).toBe("space stage · c commit");
    expect(fitHints(hints, 3, false)).toBeNull();
  });
});
