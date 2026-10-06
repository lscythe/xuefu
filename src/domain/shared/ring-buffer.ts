import { type ValidationError, validationError } from "./errors";
import { err, ok, type Result } from "./result";

/**
 * Fixed-capacity FIFO that evicts the oldest entry when full. Used for every unbounded stream
 * (logcat, process output, in-memory logs) so memory stays bounded.
 */
export class RingBuffer<T> {
  readonly #items: (T | undefined)[];
  #start = 0;
  #size = 0;
  #dropped = 0;

  private constructor(readonly capacity: number) {
    this.#items = new Array<T | undefined>(capacity);
  }

  static create<T>(capacity: number): Result<RingBuffer<T>, ValidationError> {
    if (!Number.isSafeInteger(capacity) || capacity < 1) {
      return err(
        validationError("Ring buffer capacity must be a positive integer", [
          { path: "capacity", message: `received ${String(capacity)}` },
        ]),
      );
    }
    return ok(new RingBuffer<T>(capacity));
  }

  get size(): number {
    return this.#size;
  }

  /** Number of items evicted since creation. */
  get dropped(): number {
    return this.#dropped;
  }

  push(item: T): void {
    const end = (this.#start + this.#size) % this.capacity;
    this.#items[end] = item;
    if (this.#size < this.capacity) {
      this.#size += 1;
    } else {
      this.#start = (this.#start + 1) % this.capacity;
      this.#dropped += 1;
    }
  }

  clear(): void {
    this.#items.fill(undefined);
    this.#start = 0;
    this.#size = 0;
  }

  toArray(): T[] {
    const out: T[] = [];
    for (let i = 0; i < this.#size; i += 1) {
      const item = this.#items[(this.#start + i) % this.capacity];
      // Slots inside [start, start+size) are always populated; undefined is a legal T though.
      out.push(item as T);
    }
    return out;
  }
}
