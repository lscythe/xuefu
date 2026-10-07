import { MAX_TABS } from "../../domain/workspace/tabs";
import type { IconSet } from "../theme/status";

export type ShellAction =
  | { readonly kind: "nav"; readonly to: "previous" | "next" | "first" | "last" }
  | { readonly kind: "switcher.open" }
  | { readonly kind: "palette.open" }
  /** Alt+1..9: bring that tab to the front. */
  | { readonly kind: "tab.focus"; readonly position: number }
  | { readonly kind: "tab.close" }
  /** Start, pause or resume the front workspace's timer; Shift+T stops it. */
  | { readonly kind: "timer.toggle" }
  | { readonly kind: "timer.stop" }
  | { readonly kind: "quit" }
  /** Ctrl+C: quits from anywhere, including while an overlay owns the keyboard. */
  | { readonly kind: "interrupt" };

/** The parts of a terminal key event the shell cares about; OpenTUI's KeyEvent satisfies it. */
export interface KeyPress {
  readonly name: string;
  readonly ctrl: boolean;
  readonly meta: boolean;
  readonly shift: boolean;
}

export interface KeyHint {
  readonly keys: string;
  readonly label: string;
}

/** Chords are written "ctrl+c" (Alt arrives as meta); modifiers must match, so "Q" is not "q". */
const BINDINGS: readonly (readonly [chord: string, action: ShellAction])[] = [
  ["up", { kind: "nav", to: "previous" }],
  ["k", { kind: "nav", to: "previous" }],
  ["down", { kind: "nav", to: "next" }],
  ["j", { kind: "nav", to: "next" }],
  ["home", { kind: "nav", to: "first" }],
  ["end", { kind: "nav", to: "last" }],
  ["ctrl+w", { kind: "switcher.open" }],
  [":", { kind: "palette.open" }],
  ...Array.from(
    { length: MAX_TABS },
    (_, i) => [`meta+${i + 1}`, { kind: "tab.focus", position: i + 1 }] as const,
  ),
  ["meta+w", { kind: "tab.close" }],
  ["t", { kind: "timer.toggle" }],
  ["shift+t", { kind: "timer.stop" }],
  ["q", { kind: "quit" }],
  ["ctrl+c", { kind: "interrupt" }],
];

function chordOf(key: KeyPress): string {
  return [key.ctrl ? "ctrl+" : "", key.meta ? "meta+" : "", key.shift ? "shift+" : "", key.name]
    .filter((part) => part !== "")
    .join("");
}

export function actionFor(key: KeyPress): ShellAction | null {
  const chord = chordOf(key);
  return BINDINGS.find(([bound]) => bound === chord)?.[1] ?? null;
}

/** What the key bar shows; kept next to BINDINGS so a hint never advertises an unbound key. */
export function keyHints(
  icons: IconSet,
  state: { readonly tabs: boolean; readonly timer: boolean },
): readonly KeyHint[] {
  return [
    { keys: icons === "ascii" ? "j/k" : "↑↓", label: "navigate" },
    { keys: "^W", label: "workspaces" },
    ...(state.tabs ? [{ keys: "alt+1-9", label: "tabs" }] : []),
    ...(state.timer ? [{ keys: "t", label: "timer" }] : []),
    // Everything else, Alt+W included, is listed in the palette with its key.
    { keys: ":", label: "commands" },
    { keys: "q", label: "quit" },
  ];
}
