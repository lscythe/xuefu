import type { PaletteToken } from "../theme/palette";
import { wrapText } from "../wrap";

/** One thing said or done in a conversation with an agent. */
export type TranscriptEntry =
  | { readonly kind: "you"; readonly text: string }
  | { readonly kind: "agent"; readonly text: string }
  | {
      readonly kind: "tool";
      readonly name: string;
      readonly input: Readonly<Record<string, unknown>>;
    }
  | { readonly kind: "note"; readonly text: string; readonly tone: "muted" | "error" };

/** A line of the transcript as drawn. */
export interface TranscriptRow {
  readonly text: string;
  readonly tone: PaletteToken;
}

/** Longest a tool's arguments are shown, so a step stays on one line. */
const MAX_TOOL_LINE = 80;

/**
 * A tool the agent used, in a few words: its name as a command, then the values it was given,
 * paths under the folder it works in shown from there.
 */
export function toolLine(
  name: string,
  input: Readonly<Record<string, unknown>>,
  cwd: string,
): string {
  const values = Object.values(input)
    .filter((value) => typeof value === "string" || typeof value === "number")
    .map((value) => String(value).replace(`${cwd}/`, "").replace(/\s+/gu, " "));
  const line = [name.replaceAll("_", " "), ...values].join(" ");
  return line.length > MAX_TOOL_LINE ? `${line.slice(0, MAX_TOOL_LINE - 1)}…` : line;
}

/**
 * The transcript in lines of at most `width` columns: your messages after a marker, the agent's
 * answers as written, and the tools it uses as dim steps between them.
 */
export function transcriptRows(
  entries: readonly TranscriptEntry[],
  width: number,
  cwd: string,
  ascii: boolean,
): TranscriptRow[] {
  const rows: TranscriptRow[] = [];
  const add = (text: string, tone: PaletteToken, first: string, rest: string) => {
    const lines = wrapText(text.trim(), Math.max(1, width - Bun.stringWidth(first)));
    lines.forEach((line, index) => {
      rows.push({ text: `${index === 0 ? first : rest}${line}`, tone });
    });
  };
  const step = (kind: TranscriptEntry["kind"] | null) => kind === "tool" || kind === "note";
  let previous: TranscriptEntry["kind"] | null = null;
  for (const entry of entries) {
    // A blank line between turns, and around the agent's answers; notes and tool steps keep together.
    if (previous !== null && !(step(previous) && step(entry.kind))) {
      rows.push({ text: "", tone: "text" });
    }
    previous = entry.kind;
    switch (entry.kind) {
      case "you":
        add(entry.text, "accentSecondary", ascii ? "> " : "› ", "  ");
        break;
      case "agent":
        add(entry.text, "text", "", "");
        break;
      case "tool":
        add(toolLine(entry.name, entry.input, cwd), "textMuted", ascii ? "-> " : "↳ ", "   ");
        break;
      case "note":
        add(entry.text, entry.tone === "error" ? "error" : "textMuted", "", "");
        break;
    }
  }
  return rows;
}
