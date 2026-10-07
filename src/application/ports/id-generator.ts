import type { CorrelationId, EventId, TimerId } from "../../domain/shared/ids";

export interface IdGenerator {
  /** Time-ordered so ledger ids sort chronologically. */
  eventId(): EventId;
  correlationId(): CorrelationId;
  timerId(): TimerId;
}
