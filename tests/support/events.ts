import { createEvent, type DomainEvent } from "../../src/domain/shared/event";
import type { CorrelationId, EventId, WorkspaceId } from "../../src/domain/shared/ids";
import type { Timestamp } from "../../src/domain/shared/time";

let counter = 0;

/** Builds a valid event with sensible defaults; override any field. */
export function testEvent<P extends object = { issueKey: string }>(
  overrides: Partial<DomainEvent<string, P>> = {},
): DomainEvent<string, P> {
  counter += 1;
  return createEvent({
    id: `evt-${counter}` as EventId,
    type: "WorkStarted",
    version: 1,
    occurredAt: (1_760_000_000_000 + counter) as Timestamp,
    workspaceId: "mobile-banking" as WorkspaceId,
    correlationId: "corr-1" as CorrelationId,
    payload: { issueKey: "MOB-2841" } as unknown as P,
    ...overrides,
  }) as DomainEvent<string, P>;
}
