import { describe, expect, test } from "bun:test";
import { actionFor, type KeyPress, keyHints } from "../../../../src/tui/shell/keymap";

const press = (name: string, modifiers: Partial<Omit<KeyPress, "name">> = {}): KeyPress => ({
  name,
  ctrl: false,
  meta: false,
  shift: false,
  ...modifiers,
});

describe("actionFor", () => {
  test.each([
    [press("up"), "nav.previous"],
    [press("k"), "nav.previous"],
    [press("down"), "nav.next"],
    [press("j"), "nav.next"],
    [press("home"), "nav.first"],
    [press("end"), "nav.last"],
    [press("q"), "quit"],
    [press("c", { ctrl: true }), "quit"],
  ] as const)("%o → %s", (key, action) => {
    expect(actionFor(key)).toBe(action);
  });

  test.each([
    press("x"),
    press("c"),
    press("q", { ctrl: true }),
    press("q", { shift: true }),
    press("j", { meta: true }),
  ])("%o is unbound", (key) => {
    expect(actionFor(key)).toBeNull();
  });
});

describe("keyHints", () => {
  test("every hint names a bound action", () => {
    expect(keyHints("unicode")).toEqual([
      { keys: "↑↓", label: "navigate" },
      { keys: "q", label: "quit" },
    ]);
  });

  test("ascii icons avoid arrow glyphs", () => {
    expect(keyHints("ascii")[0]).toEqual({ keys: "j/k", label: "navigate" });
    expect(keyHints("nerd")).toEqual(keyHints("unicode"));
  });
});
