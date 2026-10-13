import type { PaletteToken } from "../theme/palette";

/** A run of text drawn in one style. */
export interface Span {
  readonly text: string;
  readonly tone: PaletteToken;
  readonly bold?: boolean;
  readonly italic?: boolean;
}

/** A line as drawn: its runs of text, left to right. */
export type StyledLine = readonly Span[];

type Style = Omit<Span, "text">;

interface Cell {
  readonly char: string;
  readonly style: Style;
}

const sameStyle = (a: Style, b: Style) =>
  a.tone === b.tone &&
  (a.bold ?? false) === (b.bold ?? false) &&
  (a.italic ?? false) === (b.italic ?? false);

/** Characters back into runs, one for each change of style. */
function joined(cells: readonly Cell[]): Span[] {
  const spans: Span[] = [];
  for (const { char, style } of cells) {
    const last = spans.at(-1);
    if (last !== undefined && sameStyle(last, style))
      spans[spans.length - 1] = { ...last, text: last.text + char };
    else spans.push({ ...style, text: char });
  }
  return spans;
}

const cellsOf = (spans: readonly Span[]): Cell[] =>
  spans.flatMap((span) => Array.from(span.text).map((char) => ({ char, style: span })));

const widthOf = (cells: readonly Cell[]) =>
  cells.reduce((total, cell) => total + Bun.stringWidth(cell.char), 0);

/**
 * `spans` in lines of at most `width` columns, broken at spaces, and inside a word only when it is
 * longer than a line; each keeps its style across the break. The first line starts with `first`,
 * the rest with `rest`, such as a marker and the indent under it. A line break in the text starts
 * a line, and a blank one is left empty, as a line drawn must never hold one.
 */
export function wrapSpans(
  spans: readonly Span[],
  width: number,
  first: readonly Span[] = [],
  rest: readonly Span[] = [],
): StyledLine[] {
  const paragraphs: Cell[][] = [[]];
  for (const cell of cellsOf(spans)) {
    if (cell.char === "\n") paragraphs.push([]);
    else if (cell.char === "\t")
      paragraphs.at(-1)?.push({ ...cell, char: " " }, { ...cell, char: " " });
    else if (cell.char !== "\r") paragraphs.at(-1)?.push(cell);
  }
  return paragraphs.flatMap((cells, index) =>
    index > 0 && cells.every((cell) => cell.char === " ")
      ? [[]]
      : wrapCells(cells, width, index === 0 ? first : rest, rest),
  );
}

/** One paragraph's characters in lines, as `wrapSpans` has them. */
function wrapCells(
  cells: readonly Cell[],
  width: number,
  first: readonly Span[],
  rest: readonly Span[],
): StyledLine[] {
  const words: Cell[][] = [[]];
  for (const cell of cells) {
    if (cell.char === " ") {
      if ((words.at(-1) ?? []).length > 0) words.push([]);
    } else words.at(-1)?.push(cell);
  }
  const lines: StyledLine[] = [];
  let line = cellsOf(first);
  let room = Math.max(1, width - widthOf(line));
  let used = 0;
  const next = () => {
    lines.push(joined(line));
    line = cellsOf(rest);
    room = Math.max(1, width - widthOf(line));
    used = 0;
  };
  for (const word of words.filter((each) => each.length > 0)) {
    const size = widthOf(word);
    if (used > 0 && used + 1 + size <= room) {
      line.push({ char: " ", style: word[0]?.style ?? { tone: "text" } }, ...word);
      used += 1 + size;
      continue;
    }
    if (used > 0) next();
    let left = word;
    while (widthOf(left) > room) {
      let taken = 0;
      let count = 0;
      for (const cell of left) {
        const cellWidth = Bun.stringWidth(cell.char);
        if (count > 0 && taken + cellWidth > room) break;
        taken += cellWidth;
        count += 1;
      }
      line.push(...left.slice(0, count));
      left = left.slice(count);
      next();
    }
    line.push(...left);
    used = widthOf(left);
  }
  lines.push(joined(line));
  return lines;
}

/** A file and line, as agents cite them: app/src/Login.kt:11, or a range of lines. */
const INLINE =
  /(`[^`\n]+`)|(\*\*[^*\n]+\*\*|__[^_\n]+__)|((?:[\w.-]+\/)*[\w-]+\.[A-Za-z][\w]*:\d+(?:-\d+)?)/gu;

/**
 * A line of Markdown's inline marks as runs: `code` in the code colour, **bold** in bold, and a
 * file and line in the colour files have elsewhere, around text in `tone`.
 */
export function inlineSpans(text: string, tone: PaletteToken, base: Style = { tone }): Span[] {
  const spans: Span[] = [];
  let at = 0;
  for (const match of text.matchAll(INLINE)) {
    if (match.index > at) spans.push({ ...base, tone, text: text.slice(at, match.index) });
    const [whole, code, bold] = match;
    if (code !== undefined)
      spans.push({ ...base, tone: "accentSpectral", text: code.slice(1, -1) });
    else if (bold !== undefined) spans.push({ ...base, tone, bold: true, text: bold.slice(2, -2) });
    else spans.push({ ...base, tone: "accentSecondary", text: whole });
    at = match.index + whole.length;
  }
  if (at < text.length) spans.push({ ...base, tone, text: text.slice(at) });
  return spans;
}

/** How a line of code in a fence is coloured: a diff's additions, removals and hunks. */
function codeTone(line: string): PaletteToken {
  if (line.startsWith("+")) return "success";
  if (line.startsWith("-")) return "error";
  if (line.startsWith("@@")) return "accentSecondary";
  return "text";
}

/**
 * An agent's answer in lines of at most `width` columns, its Markdown drawn rather than shown:
 * headings in bold, lists behind their markers, quotes and code fenced off by a bar, a diff's
 * lines in its colours, and the inline marks of `inlineSpans`.
 */
export function markdownLines(text: string, width: number, ascii: boolean): StyledLine[] {
  const bar: Span = { text: ascii ? "| " : "▎ ", tone: "borderIdle" };
  const lines: StyledLine[] = [];
  let fenced = false;
  for (const line of text.replace(/\r\n?/gu, "\n").replace(/\t/gu, "  ").split("\n")) {
    if (/^\s*(```|~~~)/u.test(line)) {
      fenced = !fenced;
      continue;
    }
    if (fenced) {
      // Code keeps its spaces; a long line is cut, not wrapped at words.
      const room = Math.max(1, width - Bun.stringWidth(bar.text));
      const tone = codeTone(line);
      let left = line === "" ? " " : line;
      do {
        let cut = "";
        for (const char of left) {
          if (cut !== "" && Bun.stringWidth(cut + char) > room) break;
          cut += char;
        }
        lines.push([bar, { text: cut, tone }]);
        left = left.slice(cut.length);
      } while (left !== "");
      continue;
    }
    if (line.trim() === "") {
      lines.push([]);
      continue;
    }
    const heading = /^#{1,6}\s+(.*)$/u.exec(line.trim());
    if (heading !== null) {
      lines.push(
        ...wrapSpans(inlineSpans(heading[1] ?? "", "text", { tone: "text", bold: true }), width),
      );
      continue;
    }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/u.test(line)) {
      lines.push([{ text: (ascii ? "-" : "─").repeat(Math.min(width, 40)), tone: "borderIdle" }]);
      continue;
    }
    const quote = /^\s*>\s?(.*)$/u.exec(line);
    if (quote !== null) {
      const said = inlineSpans(quote[1] ?? "", "textMuted", { tone: "textMuted", italic: true });
      lines.push(...wrapSpans(said, width, [bar], [bar]));
      continue;
    }
    const item = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/u.exec(line);
    if (item !== null) {
      const [, indent = "", mark = "", said = ""] = item;
      const marker = /\d/u.test(mark) ? mark : ascii ? "-" : "•";
      lines.push(
        ...wrapSpans(
          inlineSpans(said, "text"),
          width,
          [
            { text: indent, tone: "text" },
            { text: `${marker} `, tone: "accentTertiary", bold: true },
          ],
          [{ text: " ".repeat(indent.length + Bun.stringWidth(marker) + 1), tone: "text" }],
        ),
      );
      continue;
    }
    const indent = /^ */u.exec(line)?.[0] ?? "";
    const lead: Span[] = indent === "" ? [] : [{ text: indent, tone: "text" }];
    lines.push(...wrapSpans(inlineSpans(line.trim(), "text"), width, lead, lead));
  }
  return lines;
}
