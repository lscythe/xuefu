import { describeCause } from "../../domain/shared/errors";
import type { DomainEvent } from "../../domain/shared/event";
import type { EventPublisher, PublishFailure, PublishReport } from "../ports/event-publisher";
import type { Logger } from "../ports/logger";

export type EventHandler = (event: DomainEvent) => void | Promise<void>;

interface Subscription {
  readonly type: string;
  readonly name: string;
  readonly handler: EventHandler;
}

export const ANY_EVENT = "*";

/**
 * In-process pub/sub for committed events. Delivery is sequential and ordered; a failing
 * subscriber is logged and reported but never affects the publisher or other subscribers.
 */
export class EventBus implements EventPublisher {
  #subscriptions: readonly Subscription[] = [];
  #anonymous = 0;

  constructor(private readonly logger: Logger) {}

  subscribe(type: string, handler: EventHandler, name?: string): () => void {
    this.#anonymous += 1;
    const subscription: Subscription = {
      type,
      handler,
      name: name ?? `subscriber-${this.#anonymous}`,
    };
    this.#subscriptions = [...this.#subscriptions, subscription];
    return () => {
      this.#subscriptions = this.#subscriptions.filter((s) => s !== subscription);
    };
  }

  async publish(events: readonly DomainEvent[]): Promise<PublishReport> {
    const failures: PublishFailure[] = [];
    let delivered = 0;
    for (const event of events) {
      // Snapshot: subscriptions made while handling this event start with the next one.
      const targets = this.#subscriptions.filter(
        (s) => s.type === ANY_EVENT || s.type === event.type,
      );
      for (const subscription of targets) {
        try {
          await subscription.handler(event);
          delivered += 1;
        } catch (thrown) {
          const error = describeCause(thrown);
          failures.push({ eventId: event.id, subscriber: subscription.name, error });
          this.logger.error("Event subscriber failed", {
            correlationId: event.correlationId,
            eventId: event.id,
            eventType: event.type,
            subscriber: subscription.name,
            error,
          });
        }
      }
    }
    return { delivered, failures };
  }
}
