/** Moves `delta` steps through a list of `count` items, wrapping at both ends. */
export function cycle(index: number, delta: number, count: number): number {
  return (((index + delta) % count) + count) % count;
}

/** First visible row for a window of `height` rows, keeping `selected` near the middle. */
export function scrollOffset(selected: number, rowCount: number, height: number): number {
  const centred = selected - Math.floor(height / 2);
  return Math.max(0, Math.min(centred, rowCount - height));
}
