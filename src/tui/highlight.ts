export interface Segment {
  readonly text: string;
  readonly hit: boolean;
}

/** Splits `text` into alternating runs of highlighted and plain code points. */
export function segments(text: string, hits: readonly number[]): Segment[] {
  const marked = new Set(hits);
  const parts: { text: string; hit: boolean }[] = [];
  Array.from(text).forEach((char, index) => {
    const hit = marked.has(index);
    const last = parts.at(-1);
    if (last?.hit === hit) last.text += char;
    else parts.push({ text: char, hit });
  });
  return parts;
}
