import type { CorrelationId, EventId, NoteId, TimerId, WorkId } from "../../domain/shared/ids";

export interface IdGenerator {
  /** Time-ordered so ledger ids sort chronologically. */
  eventId(): EventId;
  correlationId(): CorrelationId;
  timerId(): TimerId;
  workId(): WorkId;
  noteId(): NoteId;
}
