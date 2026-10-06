import type { IconSet } from "../theme/status";

export type ShellAction =
  | "nav.previous"
  | "nav.next"
  | "nav.first"
  | "nav.last"
  | "switcher.open"
  | "quit"
  /** Ctrl+C: quits from anywhere, including while an overlay owns the keyboard. */
  | "interrupt";

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

/** Chords are written "ctrl+c"; modifiers must match exactly, so "Q" is not "q". */
const BINDINGS: Readonly<Record<ShellAction, readonly string[]>> = {
  "nav.previous": ["up", "k"],
  "nav.next": ["down", "j"],
  "nav.first": ["home"],
  "nav.last": ["end"],
  "switcher.open": ["ctrl+w"],
  quit: ["q"],
  interrupt: ["ctrl+c"],
};

function chordOf(key: KeyPress): string {
  return [key.ctrl ? "ctrl+" : "", key.meta ? "meta+" : "", key.shift ? "shift+" : "", key.name]
    .filter((part) => part !== "")
    .join("");
}

export function actionFor(key: KeyPress): ShellAction | null {
  const chord = chordOf(key);
  for (const [action, chords] of Object.entries(BINDINGS) as [ShellAction, readonly string[]][]) {
    if (chords.includes(chord)) return action;
  }
  return null;
}

/** What the key bar shows; kept next to BINDINGS so a hint never advertises an unbound key. */
export function keyHints(icons: IconSet): readonly KeyHint[] {
  return [
    { keys: icons === "ascii" ? "j/k" : "↑↓", label: "navigate" },
    { keys: "^W", label: "workspaces" },
    { keys: "q", label: "quit" },
  ];
}
