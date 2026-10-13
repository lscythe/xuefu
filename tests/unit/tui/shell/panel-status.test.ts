import { describe, expect, test } from "bun:test";
import { fitHints, workKeys } from "../../../../src/tui/shell/panel-status";

describe("workKeys", () => {
  test("starting work with a workspace in front, then what the timer key does", () => {
    expect(workKeys(true, "start", false)).toBe("s start work · t start timer");
    expect(workKeys(true, "pause", true)).toBe("s start work | t pause | T stop");
    expect(workKeys(true, null, false)).toBe("s start work");
    expect(workKeys(false, "resume", false)).toBe("t resume · T stop");
    expect(workKeys(false, null, false)).toBeNull();
  });
});

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
