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

// Notes and a day's tasks are never recorded: what was done may not belong in the history.
const TimeEntryAddedV1 = defineEvent(
  "TimeEntryAdded",
  1,
  z.strictObject({
    entryId: z.string(),
    issueKey: z.string().nullable(),
    category: z.string().nullable(),
    durationMs: z.number().int().positive(),
  }),
);

const TimeEntryChangedV1 = defineEvent(
  "TimeEntryChanged",
  1,
  z.strictObject({ entryId: z.string(), durationMs: z.number().int().positive() }),
);

const TimeEntryDeletedV1 = defineEvent(
  "TimeEntryDeleted",
  1,
  z.strictObject({ entryId: z.string(), durationMs: z.number().int().positive() }),
);

const TimerSegmentMovedV1 = defineEvent(
  "TimerSegmentMoved",
  1,
  z.strictObject({ timerId: z.string(), position: z.number().int().nonnegative() }),
);

/** `tasks` says whether the day has its tasks written, not what they are. */
const TimesheetDayChangedV1 = defineEvent(
  "TimesheetDayChanged",
  1,
  z.strictObject({ day: z.string(), leave: z.boolean(), tasks: z.boolean() }),
);

export type TimerStartedPayload = z.infer<typeof TimerStartedV1.schema>;
export type TimerPausedPayload = z.infer<typeof TimerPausedV1.schema>;
export type TimerResumedPayload = z.infer<typeof TimerResumedV1.schema>;
export type TimerStoppedPayload = z.infer<typeof TimerStoppedV1.schema>;
export type TimeEntryAddedPayload = z.infer<typeof TimeEntryAddedV1.schema>;
export type TimeEntryChangedPayload = z.infer<typeof TimeEntryChangedV1.schema>;
export type TimeEntryDeletedPayload = z.infer<typeof TimeEntryDeletedV1.schema>;
export type TimerSegmentMovedPayload = z.infer<typeof TimerSegmentMovedV1.schema>;
export type TimesheetDayChangedPayload = z.infer<typeof TimesheetDayChangedV1.schema>;

export const TIMER_EVENTS: readonly EventDefinition[] = [
  TimerStartedV1,
  TimerPausedV1,
  TimerResumedV1,
  TimerStoppedV1,
  TimeEntryAddedV1,
  TimeEntryChangedV1,
  TimeEntryDeletedV1,
  TimerSegmentMovedV1,
  TimesheetDayChangedV1,
];
