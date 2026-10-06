import type { Clock } from "../../application/ports/clock";
import { type Timestamp, timestamp } from "../../domain/shared/time";

export const systemClock: Clock = {
  now(): Timestamp {
    const now = timestamp(Date.now());
    // A pre-1970 system clock is a broken host, not a recoverable condition.
    if (!now.ok) throw new Error(`System clock returned an invalid time: ${now.error.message}`);
    return now.value;
  },
};
