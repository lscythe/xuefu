import type { IdGenerator } from "../../src/application/ports/id-generator";
import type { CorrelationId, EventId, NoteId, TimerId, WorkId } from "../../src/domain/shared/ids";

/** Predictable ids for assertions: evt-1, evt-2, …, corr-1, corr-2, …, tmr-N, wrk-N and not-N */
export class SequentialIds implements IdGenerator {
  #event = 0;
  #correlation = 0;
  #timer = 0;
  #work = 0;
  #note = 0;

  eventId(): EventId {
    this.#event += 1;
    return `evt-${this.#event}` as EventId;
  }

  correlationId(): CorrelationId {
    this.#correlation += 1;
    return `corr-${this.#correlation}` as CorrelationId;
  }

  timerId(): TimerId {
    this.#timer += 1;
    return `tmr-${this.#timer}` as TimerId;
  }

  workId(): WorkId {
    this.#work += 1;
    return `wrk-${this.#work}` as WorkId;
  }

  noteId(): NoteId {
    this.#note += 1;
    return `not-${this.#note}` as NoteId;
  }
}
