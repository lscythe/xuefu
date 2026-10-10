/** The longest start of `text` that fits in `width` columns, taking at least one character. */
function head(text: string, width: number): string {
  let taken = "";
  for (const char of text) {
    if (taken !== "" && Bun.stringWidth(taken + char) > width) break;
    taken += char;
  }
  return taken;
}

/**
 * `text` in lines of at most `width` columns, broken at spaces, and inside a word only when it is
 * longer than a line. Line breaks and indents are kept, blank lines included; tabs become two spaces.
 */
export function wrapText(text: string, width: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.replace(/\r\n?/g, "\n").replace(/\t/g, "  ").split("\n")) {
    // A paragraph's indent is kept on its first line, as long as a word still fits after it.
    const indent = /^ */.exec(paragraph)?.[0] ?? "";
    let line = indent.length < width ? indent : "";
    let empty = true;
    for (const word of paragraph.trim().split(/ +/)) {
      if (word === "") continue;
      const joined = empty ? line + word : `${line} ${word}`;
      if (Bun.stringWidth(joined) <= width) {
        line = joined;
        empty = false;
        continue;
      }
      if (!empty) lines.push(line);
      let rest = word;
      while (Bun.stringWidth(rest) > width) {
        const part = head(rest, width);
        lines.push(part);
        rest = rest.slice(part.length);
      }
      line = rest;
      empty = false;
    }
    lines.push(empty ? "" : line);
  }
  return lines;
}
