export interface FuzzyMatch {
  readonly score: number;
  /** Code-point indices into the text, increasing; empty for an empty query. */
  readonly positions: readonly number[];
}

export interface Ranked<T> {
  readonly item: T;
  readonly match: FuzzyMatch;
  /** Index of the key (from `keysOf`) that matched best. */
  readonly key: number;
}

const MATCH = 16;
const BONUS_START = 8;
const BONUS_BOUNDARY = 8;
const BONUS_CAMEL = 6;
const BONUS_CONSECUTIVE = 6;
const LETTER_OR_DIGIT = /[\p{L}\p{N}]/u;
const LOWER = /\p{Ll}/u;
const UPPER = /\p{Lu}/u;

/** Case- and accent-insensitive form of one character: "É" and "e" compare equal. */
function fold(char: string): string {
  return char.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();
}

function bonusAt(chars: readonly string[], index: number): number {
  if (index === 0) return BONUS_START;
  const previous = chars[index - 1] ?? "";
  const current = chars[index] ?? "";
  if (!LETTER_OR_DIGIT.test(previous)) return BONUS_BOUNDARY;
  if (LOWER.test(previous) && UPPER.test(current)) return BONUS_CAMEL;
  return 0;
}

/**
 * Best-scoring placement of `query` as a subsequence of `text`, or null when it is not one.
 * Word starts and consecutive runs score higher; skipped characters between matches cost one
 * point each. Scored by dynamic programming, so "mb" matches the "b" of "-banking", not of "mob".
 */
export function fuzzyMatch(query: string, text: string): FuzzyMatch | null {
  const wanted = Array.from(query, fold);
  if (wanted.length === 0) return { score: 0, positions: [] };
  const chars = Array.from(text);
  const folded = chars.map(fold);
  const n = wanted.length;
  const m = chars.length;
  if (n > m) return null;

  // best[i][j]: highest score with wanted[i] placed at text index j; from[i][j]: previous index.
  const best: number[][] = [];
  const from: number[][] = [];
  for (let i = 0; i < n; i++) {
    const row = new Array<number>(m).fill(Number.NEGATIVE_INFINITY);
    const back = new Array<number>(m).fill(-1);
    const previousRow = best[i - 1];
    // Running maximum of previousRow[k] + k over k < j - 1, for the gap transition.
    let gapBest = Number.NEGATIVE_INFINITY;
    let gapFrom = -1;
    for (let j = 0; j < m; j++) {
      if (previousRow !== undefined && j >= 2) {
        const candidate = (previousRow[j - 2] ?? Number.NEGATIVE_INFINITY) + (j - 2);
        if (candidate > gapBest) {
          gapBest = candidate;
          gapFrom = j - 2;
        }
      }
      if (folded[j] !== wanted[i]) continue;
      const gain = MATCH + bonusAt(chars, j);
      if (previousRow === undefined) {
        row[j] = gain;
        continue;
      }
      const consecutive = (previousRow[j - 1] ?? Number.NEGATIVE_INFINITY) + BONUS_CONSECUTIVE;
      const gapped = gapBest - (j - 1);
      if (consecutive >= gapped && consecutive > Number.NEGATIVE_INFINITY) {
        row[j] = gain + consecutive;
        back[j] = j - 1;
      } else if (gapped > Number.NEGATIVE_INFINITY) {
        row[j] = gain + gapped;
        back[j] = gapFrom;
      }
    }
    best.push(row);
    from.push(back);
  }

  const last = best[n - 1] ?? [];
  let end = -1;
  for (let j = 0; j < m; j++) {
    if ((last[j] ?? Number.NEGATIVE_INFINITY) > (last[end] ?? Number.NEGATIVE_INFINITY)) end = j;
  }
  if (end === -1) return null;

  const positions: number[] = [];
  for (let i = n - 1, j = end; i >= 0; i--) {
    positions.push(j);
    j = from[i]?.[j] ?? -1;
  }
  return { score: last[end] ?? 0, positions: positions.reverse() };
}

/**
 * Items whose keys match `query`, best first; ties go to the shorter matching key, then to input
 * order. An empty query returns every item in input order.
 */
export function rankFuzzy<T>(
  items: readonly T[],
  query: string,
  keysOf: (item: T) => readonly string[],
): Ranked<T>[] {
  if (query === "")
    return items.map((item) => ({ item, match: { score: 0, positions: [] }, key: 0 }));
  const ranked: (Ranked<T> & { readonly order: number; readonly length: number })[] = [];
  items.forEach((item, order) => {
    let chosen: { match: FuzzyMatch; key: number; length: number } | null = null;
    const keys = keysOf(item);
    for (let key = 0; key < keys.length; key++) {
      const text = keys[key] ?? "";
      const match = fuzzyMatch(query, text);
      if (match !== null && (chosen === null || match.score > chosen.match.score)) {
        chosen = { match, key, length: text.length };
      }
    }
    if (chosen !== null) ranked.push({ item, order, ...chosen });
  });
  ranked.sort((a, b) => b.match.score - a.match.score || a.length - b.length || a.order - b.order);
  return ranked.map(({ item, match, key }) => ({ item, match, key }));
}
