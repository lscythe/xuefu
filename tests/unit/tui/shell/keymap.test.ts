import { describe, expect, test } from "bun:test";
import {
  actionFor,
  COMMANDS_HINT,
  type KeyPress,
  keyHints,
} from "../../../../src/tui/shell/keymap";

const press = (name: string, modifiers: Partial<Omit<KeyPress, "name">> = {}): KeyPress => ({
  name,
  ctrl: false,
  meta: false,
  shift: false,
  ...modifiers,
});
const alt = (name: string) => press(name, { meta: true });

describe("actionFor", () => {
  test.each([
    [press("up"), { kind: "nav", to: "previous" }],
    [press("k"), { kind: "nav", to: "previous" }],
    [press("down"), { kind: "nav", to: "next" }],
    [press("j"), { kind: "nav", to: "next" }],
    [press("home"), { kind: "nav", to: "first" }],
    [press("end"), { kind: "nav", to: "last" }],
    [press("q"), { kind: "quit" }],
    [press("c", { ctrl: true }), { kind: "interrupt" }],
    [press("w", { ctrl: true }), { kind: "switcher.open" }],
    [press(":"), { kind: "palette.open" }],
    [alt("1"), { kind: "tab.focus", position: 1 }],
    [alt("9"), { kind: "tab.focus", position: 9 }],
    [alt("w"), { kind: "tab.close" }],
    [press("t"), { kind: "timer.toggle" }],
    [press("t", { shift: true }), { kind: "timer.stop" }],
  ] as const)("%o → %o", (key, action) => {
    expect(actionFor(key)).toEqual(action);
  });

  test.each([
    press("x"),
    press("c"),
    press("1"),
    alt("0"),
    press("q", { ctrl: true }),
    press("q", { shift: true }),
    alt("j"),
  ])("%o is unbound", (key) => {
    expect(actionFor(key)).toBeNull();
  });
});

describe("keyHints", () => {
  test("every hint names a bound action; tab keys only show with tabs open", () => {
    expect(keyHints("unicode", { tabs: false, timer: false })).toEqual([
      { keys: "↑↓", label: "navigate" },
      { keys: "^W", label: "workspaces" },
      { keys: "q", label: "quit" },
    ]);
    expect(keyHints("unicode", { tabs: true, timer: false })).toEqual([
      { keys: "↑↓", label: "navigate" },
      { keys: "^W", label: "workspaces" },
      { keys: "alt+1-9", label: "tabs" },
      { keys: "q", label: "quit" },
    ]);
  });

  test("the palette, set apart at the right of the key bar, is bound to its key", () => {
    expect(COMMANDS_HINT).toEqual({ keys: ":", label: "commands" });
    expect(actionFor({ name: ":", ctrl: false, meta: false, shift: false })).toEqual({
      kind: "palette.open",
    });
  });

  test("the timer key shows when it has something to do", () => {
    expect(keyHints("unicode", { tabs: false, timer: true })).toContainEqual({
      keys: "t",
      label: "timer",
    });
  });

  test("ascii icons avoid arrow glyphs", () => {
    expect(keyHints("ascii", { tabs: false, timer: false })[0]).toEqual({
      keys: "j/k",
      label: "navigate",
    });
    expect(keyHints("nerd", { tabs: true, timer: false })).toEqual(
      keyHints("unicode", { tabs: true, timer: false }),
    );
  });
});
