/** Columns a tab takes besides its name: " 1 " before and " " after. */
const TAB_CHROME = 4;
const ELLIPSIS = "…";

/** Cuts `text` to at most `width` display columns, ending in an ellipsis when shortened. */
export function truncateToWidth(text: string, width: number): string {
  if (Bun.stringWidth(text) <= width) return text;
  let kept = "";
  for (const char of text) {
    if (Bun.stringWidth(kept + char + ELLIPSIS) > width) break;
    kept += char;
  }
  return kept + ELLIPSIS;
}

/**
 * Names to show in a tab bar `width` columns wide: unchanged when they fit, otherwise the longest
 * names are shortened first, one column at a time, down to a lone ellipsis.
 */
export function fitTabLabels(names: readonly string[], width: number): string[] {
  const widths = names.map((name) => Bun.stringWidth(name));
  const budget = width - names.length * TAB_CHROME;
  let total = widths.reduce((sum, w) => sum + w, 0);
  while (total > budget) {
    const longest = widths.indexOf(Math.max(...widths));
    if ((widths[longest] ?? 0) <= 1) break;
    widths[longest] = (widths[longest] ?? 0) - 1;
    total -= 1;
  }
  return names.map((name, i) => truncateToWidth(name, widths[i] ?? 1));
}
