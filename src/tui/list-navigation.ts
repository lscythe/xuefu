/** Moves `delta` steps through a list of `count` items, wrapping at both ends. */
export function cycle(index: number, delta: number, count: number): number {
  return (((index + delta) % count) + count) % count;
}
