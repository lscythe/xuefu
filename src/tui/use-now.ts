import { type Accessor, createSignal, onCleanup } from "solid-js";
import type { Clock } from "../application/ports/clock";
import type { Timestamp } from "../domain/shared/time";

/**
 * The clock's time, re-read every `tickMs`. The tick only re-reads the clock; nothing
 * accumulates, so sleep/wake cannot drift.
 */
export function useNow(clock: Clock, tickMs: number): Accessor<Timestamp> {
  const [now, setNow] = createSignal(clock.now());
  const timer = setInterval(() => setNow(clock.now()), tickMs);
  onCleanup(() => clearInterval(timer));
  return now;
}
