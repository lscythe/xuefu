/** Drops the last character (a whole code point, so CJK and emoji erase cleanly). */
export function eraseChar(query: string): string {
  return Array.from(query).slice(0, -1).join("");
}

/** Ctrl+W: trailing spaces, then the last word, or the last run of punctuation if there is none. */
export function eraseWord(query: string): string {
  const trimmed = query.replace(/\s+$/u, "");
  const withoutWord = trimmed.replace(/[\p{L}\p{N}]+$/u, "");
  return withoutWord !== trimmed ? withoutWord : trimmed.replace(/[^\p{L}\p{N}\s]+$/u, "");
}

/** Pasted text as query input: whitespace runs become one space, control characters go. */
export function pastedText(text: string): string {
  return text.replace(/\s+/gu, " ").replace(/\p{C}/gu, "");
}
