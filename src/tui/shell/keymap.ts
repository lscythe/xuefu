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
  /** Tab and Shift+Tab move focus between the dashboard's panels; a digit jumps to one. */
  | { readonly kind: "panel.focus"; readonly to: "previous" | "next" }
  | { readonly kind: "panel.jump"; readonly position: number }
  /** Enter opens the focused panel's section. */
  | { readonly kind: "panel.open" }
  /** Where notes are shown: e edits the workspace's note, i the note on its work in progress. */
  | { readonly kind: "note.edit"; readonly on: "workspace" | "issue" }
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
  ["tab", { kind: "panel.focus", to: "next" }],
  ["shift+tab", { kind: "panel.focus", to: "previous" }],
  ...Array.from(
    { length: 9 },
    (_, i) => [`${i + 1}`, { kind: "panel.jump", position: i + 1 }] as const,
  ),
  ["return", { kind: "panel.open" }],
  ["e", { kind: "note.edit", on: "workspace" }],
  ["i", { kind: "note.edit", on: "issue" }],
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
  state: { readonly tabs: boolean; readonly timer: boolean; readonly panels: boolean },
): readonly KeyHint[] {
  return [
    { keys: icons === "ascii" ? "j/k" : "↑↓", label: "navigate" },
    ...(state.panels ? [{ keys: "tab", label: "focus" }] : []),
    { keys: "^W", label: "workspaces" },
    ...(state.tabs ? [{ keys: "alt+1-9", label: "tabs" }] : []),
    ...(state.timer ? [{ keys: "t", label: "timer" }] : []),
    { keys: "q", label: "quit" },
  ];
}

/** Set apart at the right of the key bar: everything else, Alt+W included, is listed there. */
export const COMMANDS_HINT: KeyHint = { keys: ":", label: "commands" };

/** Hints given up first when the key bar is too narrow; the rest are always shown. */
const SPARE_LABELS = ["tabs", "focus", "navigate"];

/** Columns a hint takes in the key bar: " keys label ". */
export const hintWidth = (hint: KeyHint) =>
  Bun.stringWidth(hint.keys) + Bun.stringWidth(hint.label) + 3;

/** The hints that fit in `width` columns, dropping the spare ones in order. */
export function fitKeyHints(hints: readonly KeyHint[], width: number): readonly KeyHint[] {
  let shown = hints;
  for (const label of SPARE_LABELS) {
    if (shown.reduce((sum, hint) => sum + hintWidth(hint), 0) <= width) break;
    shown = shown.filter((hint) => hint.label !== label);
  }
  return shown;
}
