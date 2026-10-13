import { markdownLines, type Span, type StyledLine, wrapSpans } from "./styled-text";

/** One thing said or done in a conversation with an agent. */
export type TranscriptEntry =
  | { readonly kind: "you"; readonly text: string }
  | { readonly kind: "agent"; readonly text: string }
  | { readonly kind: "thinking"; readonly text: string }
  | {
      readonly kind: "tool";
      readonly name: string;
      readonly input: Readonly<Record<string, unknown>>;
    }
  | { readonly kind: "note"; readonly text: string; readonly tone: "muted" | "error" };

/** Longest a tool's arguments are shown, so a step stays on one line. */
const MAX_TOOL_LINE = 80;
/** Lines of thinking shown while it is folded. */
const FOLDED_THINKING = 3;

/**
 * A tool the agent used, in a few words: its name as a command, then the values it was given,
 * paths under the folder it works in, if any, shown from there.
 */
export function toolLine(
  name: string,
  input: Readonly<Record<string, unknown>>,
  cwd: string | null,
): string {
  const values = Object.values(input)
    .filter((value) => typeof value === "string" || typeof value === "number")
    .map((value) => {
      const text = String(value);
      return (cwd === null ? text : text.replace(`${cwd}/`, "")).replace(/\s+/gu, " ");
    });
  const line = [name.replaceAll("_", " "), ...values].join(" ");
  return line.length > MAX_TOOL_LINE ? `${line.slice(0, MAX_TOOL_LINE - 1)}…` : line;
}

/** A marker, and the indent under it for the lines that follow. */
const marked = (text: string, tone: Span["tone"], bold = false) => ({
  first: [{ text, tone, bold }],
  rest: [{ text: " ".repeat(Bun.stringWidth(text)), tone }],
});

/** What the transcript shows, beyond its entries. */
export interface TranscriptOptions {
  /** The folder the agent works in, which paths in its tools are shown from. */
  readonly cwd: string | null;
  readonly ascii: boolean;
  /** Its thinking whole, rather than folded to its first lines. */
  readonly thinking: boolean;
}

/**
 * The transcript in lines of at most `width` columns: your messages after a marker, the agent's
 * answers with their Markdown drawn, and between them, as quieter steps, what it thinks, the
 * tools it uses and what XueFu does for it.
 */
export function transcriptRows(
  entries: readonly TranscriptEntry[],
  width: number,
  options: TranscriptOptions,
): StyledLine[] {
  const { ascii } = options;
  const rows: StyledLine[] = [];
  const step = (kind: TranscriptEntry["kind"] | null) =>
    kind === "tool" || kind === "note" || kind === "thinking";
  let previous: TranscriptEntry["kind"] | null = null;
  for (const entry of entries) {
    // A blank line between turns, and around the agent's answers; steps keep together.
    if (previous !== null && !(step(previous) && step(entry.kind))) rows.push([]);
    previous = entry.kind;
    switch (entry.kind) {
      case "you": {
        const { first, rest } = marked(ascii ? "> " : "› ", "accentSecondary", true);
        rows.push(
          ...wrapSpans([{ text: entry.text.trim(), tone: "accentSecondary" }], width, first, rest),
        );
        break;
      }
      case "agent": {
        const { first, rest } = marked(ascii ? "* " : "● ", "accentTertiary");
        markdownLines(entry.text.trim(), width - 2, ascii).forEach((line, index) => {
          rows.push(line.length === 0 ? [] : [...(index === 0 ? first : rest), ...line]);
        });
        break;
      }
      case "thinking": {
        const { first, rest } = marked(ascii ? "~ " : "✻ ", "accentSoul");
        const said = entry.text
          .trim()
          .split(/\n+/u)
          .flatMap((paragraph, index) =>
            wrapSpans(
              [{ text: paragraph, tone: "textMuted", italic: true }],
              width,
              index === 0 ? first : rest,
              rest,
            ),
          );
        const shown = options.thinking ? said : said.slice(0, FOLDED_THINKING);
        rows.push(...shown);
        const hidden = said.length - shown.length;
        if (hidden > 0) {
          rows.push([
            ...rest,
            {
              text: `${ascii ? "..." : "…"} ${hidden} more line${hidden === 1 ? "" : "s"}`,
              tone: "textMuted",
            },
          ]);
        }
        break;
      }
      case "tool": {
        const { first, rest } = marked(ascii ? "-> " : "↳ ", "textMuted");
        const line = toolLine(entry.name, entry.input, options.cwd);
        const command = entry.name.replaceAll("_", " ");
        rows.push(
          ...wrapSpans(
            [
              { text: line.slice(0, command.length), tone: "accentSecondary" },
              { text: line.slice(command.length), tone: "textMuted" },
            ],
            width,
            first,
            rest,
          ),
        );
        break;
      }
      case "note": {
        const failed = entry.tone === "error";
        const { first, rest } = marked(
          failed ? (ascii ? "x " : "✗ ") : ascii ? ". " : "· ",
          failed ? "error" : "textMuted",
        );
        rows.push(
          ...wrapSpans(
            [{ text: entry.text.trim(), tone: failed ? "error" : "textMuted" }],
            width,
            first,
            rest,
          ),
        );
        break;
      }
    }
  }
  return rows;
}
