import type { IdGenerator } from "../../src/application/ports/id-generator";
import type { CorrelationId, EventId, TimerId } from "../../src/domain/shared/ids";

/** Predictable ids for assertions: evt-1, evt-2, …, corr-1, corr-2, … and tmr-1, tmr-2, … */
export class SequentialIds implements IdGenerator {
  #event = 0;
  #correlation = 0;
  #timer = 0;

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
}
