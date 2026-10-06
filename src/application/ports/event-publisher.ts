import type { CauseSummary } from "../../domain/shared/errors";
import type { DomainEvent } from "../../domain/shared/event";
import type { EventId } from "../../domain/shared/ids";

export interface PublishFailure {
  readonly eventId: EventId;
  readonly subscriber: string;
  readonly error: CauseSummary;
}

export interface PublishReport {
  readonly delivered: number;
  readonly failures: readonly PublishFailure[];
}

/** Notifies in-process subscribers of committed facts. Never rejects. */
export interface EventPublisher {
  publish(events: readonly DomainEvent[]): Promise<PublishReport>;
}
