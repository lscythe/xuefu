import { z } from "zod";
import { defineEvent, type EventDefinition } from "../events/catalog";

const TimerStartedV1 = defineEvent(
  "TimerStarted",
  1,
  z.strictObject({ timerId: z.string(), workspaceId: z.string(), issueKey: z.string().nullable() }),
);

/** `elapsedMs` is the timer's total tracked time at that moment, across every segment. */
const TimerPausedV1 = defineEvent(
  "TimerPaused",
  1,
  z.strictObject({ timerId: z.string(), elapsedMs: z.number().int().nonnegative() }),
);

const TimerResumedV1 = defineEvent("TimerResumed", 1, z.strictObject({ timerId: z.string() }));

const TimerStoppedV1 = defineEvent(
  "TimerStopped",
  1,
  z.strictObject({ timerId: z.string(), elapsedMs: z.number().int().nonnegative() }),
);

export type TimerStartedPayload = z.infer<typeof TimerStartedV1.schema>;
export type TimerPausedPayload = z.infer<typeof TimerPausedV1.schema>;
export type TimerResumedPayload = z.infer<typeof TimerResumedV1.schema>;
export type TimerStoppedPayload = z.infer<typeof TimerStoppedV1.schema>;

export const TIMER_EVENTS: readonly EventDefinition[] = [
  TimerStartedV1,
  TimerPausedV1,
  TimerResumedV1,
  TimerStoppedV1,
];
