/** A 3×5 pixel font for a clock's digits and colons; "1" is a lit pixel. */
const FONT: Readonly<Record<string, readonly string[]>> = {
  "0": ["111", "101", "101", "101", "111"],
  "1": ["110", "010", "010", "010", "111"],
  "2": ["111", "001", "111", "100", "111"],
  "3": ["111", "001", "111", "001", "111"],
  "4": ["101", "101", "111", "001", "001"],
  "5": ["111", "100", "111", "001", "111"],
  "6": ["111", "100", "111", "101", "111"],
  "7": ["111", "001", "001", "001", "001"],
  "8": ["111", "101", "111", "101", "111"],
  "9": ["111", "101", "111", "001", "111"],
  ":": ["0", "1", "0", "1", "0"],
};
const BLANK = ["000", "000", "000", "000", "000"];

/** Large: each pixel two cells wide and a row tall. Small: two pixel rows per row, in half blocks. */
export type ClockSize = "large" | "small";

const glyph = (char: string) => FONT[char] ?? BLANK;

function largeRows(text: string): string[] {
  return [0, 1, 2, 3, 4].map((row) =>
    [...text]
      .map((char) =>
        [...(glyph(char)[row] ?? "")].map((pixel) => (pixel === "1" ? "██" : "  ")).join(""),
      )
      .join(" "),
  );
}

function smallRows(text: string): string[] {
  const cell = (upper: string | undefined, lower: string | undefined) =>
    upper === "1" ? (lower === "1" ? "█" : "▀") : lower === "1" ? "▄" : " ";
  return [0, 2, 4].map((top) =>
    [...text]
      .map((char) => {
        const upper = glyph(char)[top] ?? "";
        const lower = glyph(char)[top + 1];
        return [...upper].map((pixel, i) => cell(pixel, lower?.[i])).join("");
      })
      .join(" "),
  );
}

/** "01:42:18" drawn in block characters, one string per terminal row. */
export function bigClockRows(text: string, size: ClockSize): string[] {
  return size === "large" ? largeRows(text) : smallRows(text);
}

/**
 * The largest clock that fits `columns` × `rows`, or null when even the small one does not and
 * the time should be written plainly.
 */
export function fitClock(text: string, columns: number, rows: number): ClockSize | null {
  for (const size of ["large", "small"] as const) {
    const drawn = bigClockRows(text, size);
    if (drawn.length <= rows && Bun.stringWidth(drawn[0] ?? "") <= columns) return size;
  }
  return null;
}
