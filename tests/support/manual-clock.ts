import type { Clock } from "../../src/application/ports/clock";
import type { Timestamp } from "../../src/domain/shared/time";

/** Deterministic clock for tests; time only moves when told to. */
export class ManualClock implements Clock {
  #now: number;

  constructor(start = Date.UTC(2026, 9, 6, 9, 0, 0)) {
    this.#now = start;
  }

  now(): Timestamp {
    return this.#now as Timestamp;
  }

  advance(ms: number): void {
    this.#now += ms;
  }

  set(epochMs: number): void {
    this.#now = epochMs;
  }
}
