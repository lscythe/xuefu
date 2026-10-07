import type { KeyPress } from "../shell/keymap";

export interface TypedKey extends KeyPress {
  /** The raw text the key produced, e.g. "Q" for shift+q or "符" from an IME. */
  readonly sequence: string;
}

export type QueryAction =
  | { readonly kind: "close" }
  | { readonly kind: "choose" }
  | { readonly kind: "move"; readonly delta: 1 | -1 }
  | { readonly kind: "erase"; readonly unit: "char" | "word" | "all" }
  | { readonly kind: "type"; readonly text: string };

const CONTROL = /\p{C}/u;

function printable(key: TypedKey): string | null {
  if (key.ctrl || key.meta) return null;
  const chars = Array.from(key.sequence);
  return chars.length === 1 && !CONTROL.test(key.sequence) ? key.sequence : null;
}

/** Keys while an overlay takes typing; letters type into its query, so j/k/q do not navigate. */
export function queryActionFor(key: TypedKey): QueryAction | null {
  if (key.ctrl && !key.meta) {
    switch (key.name) {
      case "p":
        return { kind: "move", delta: -1 };
      case "n":
        return { kind: "move", delta: 1 };
      case "w":
        return { kind: "erase", unit: "word" };
      case "u":
        return { kind: "erase", unit: "all" };
      default:
        return null;
    }
  }
  switch (key.name) {
    case "escape":
      return { kind: "close" };
    case "return":
      return { kind: "choose" };
    case "up":
      return { kind: "move", delta: -1 };
    case "down":
      return { kind: "move", delta: 1 };
    case "backspace":
      return { kind: "erase", unit: "char" };
  }
  const text = printable(key);
  return text === null ? null : { kind: "type", text };
}
