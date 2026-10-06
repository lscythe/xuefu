/** Smallest terminal the cockpit lays out in; anything smaller gets a notice instead. */
export const MIN_COLUMNS = 80;
export const MIN_ROWS = 24;

export function fitsTerminal(columns: number, rows: number): boolean {
  return columns >= MIN_COLUMNS && rows >= MIN_ROWS;
}
