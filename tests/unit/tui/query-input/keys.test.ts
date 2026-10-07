import { describe, expect, test } from "bun:test";
import { queryActionFor, type TypedKey } from "../../../../src/tui/query-input/keys";

const key = (name: string, sequence = name, modifiers: Partial<TypedKey> = {}): TypedKey => ({
  name,
  sequence,
  ctrl: false,
  meta: false,
  shift: false,
  ...modifiers,
});
const ctrl = (name: string) => key(name, "", { ctrl: true });

describe("queryActionFor", () => {
  test.each([
    [key("escape", "\u001b"), { kind: "close" }],
    [key("return", "\r"), { kind: "choose" }],
    [key("up", ""), { kind: "move", delta: -1 }],
    [ctrl("p"), { kind: "move", delta: -1 }],
    [key("down", ""), { kind: "move", delta: 1 }],
    [ctrl("n"), { kind: "move", delta: 1 }],
    [key("backspace", "\b"), { kind: "erase", unit: "char" }],
    [ctrl("w"), { kind: "erase", unit: "word" }],
    [ctrl("u"), { kind: "erase", unit: "all" }],
    [key("m"), { kind: "type", text: "m" }],
    [key("q", "Q", { shift: true }), { kind: "type", text: "Q" }],
    [key("space", " "), { kind: "type", text: " " }],
    [key("符"), { kind: "type", text: "符" }],
    [key("j"), { kind: "type", text: "j" }],
  ] as const)("%o → %o", (pressed, action) => {
    expect(queryActionFor(pressed)).toEqual(action);
  });

  test.each([
    ctrl("x"),
    key("tab", "\t"),
    key("x", "x", { meta: true }),
    key("f1", "\u001bOP"),
    key("delete", "\u001b[3~"),
  ])("%o does nothing", (pressed) => {
    expect(queryActionFor(pressed)).toBeNull();
  });
});
