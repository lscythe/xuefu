import type { CorrelationId, EventId } from "../../domain/shared/ids";

export interface IdGenerator {
  /** Time-ordered so ledger ids sort chronologically. */
  eventId(): EventId;
  correlationId(): CorrelationId;
}
