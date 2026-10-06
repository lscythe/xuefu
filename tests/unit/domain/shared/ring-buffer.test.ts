import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import { RingBuffer } from "../../../../src/domain/shared/ring-buffer";

describe("RingBuffer", () => {
  test("rejects non-positive or non-integer capacity", () => {
    expect(RingBuffer.create(0).ok).toBe(false);
    expect(RingBuffer.create(1.5).ok).toBe(false);
    expect(RingBuffer.create(1).ok).toBe(true);
  });

  const make = (capacity: number) => {
    const result = RingBuffer.create<number>(capacity);
    if (!result.ok) throw new Error("capacity");
    return result.value;
  };

  test("keeps insertion order and evicts the oldest items", () => {
    const buffer = make(3);
    for (const n of [1, 2, 3, 4, 5]) buffer.push(n);
    expect(buffer.toArray()).toEqual([3, 4, 5]);
    expect(buffer.size).toBe(3);
    expect(buffer.dropped).toBe(2);
  });

  test("clear empties the buffer but keeps the drop counter", () => {
    const buffer = make(2);
    for (const n of [1, 2, 3]) buffer.push(n);
    buffer.clear();
    expect(buffer.toArray()).toEqual([]);
    expect(buffer.dropped).toBe(1);
  });

  test("toArray returns a copy", () => {
    const buffer = make(2);
    buffer.push(1);
    const snapshot = buffer.toArray();
    buffer.push(2);
    expect(snapshot).toEqual([1]);
  });

  test("invariant: size never exceeds capacity and the newest items are retained", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 50 }),
        fc.array(fc.integer(), { maxLength: 500 }),
        (capacity, items) => {
          const buffer = make(capacity);
          for (const item of items) buffer.push(item);
          expect(buffer.size).toBeLessThanOrEqual(capacity);
          expect(buffer.toArray()).toEqual(items.slice(-capacity));
          expect(buffer.dropped).toBe(Math.max(0, items.length - capacity));
        },
      ),
    );
  });
});
