import type { CorrelationId, EventId, WorkspaceId } from "./ids";
import type { Timestamp } from "./time";

/**
 * A fact that has already happened and been confirmed. Events are appended to the activity ledger
 * in the same transaction as the state change they describe.
 */
export interface DomainEvent<TType extends string = string, TPayload = unknown> {
  readonly id: EventId;
  readonly type: TType;
  /** Payload schema version, starting at 1. */
  readonly version: number;
  readonly occurredAt: Timestamp;
  readonly workspaceId: WorkspaceId | null;
  readonly correlationId: CorrelationId;
  readonly payload: TPayload;
}

export function createEvent<TType extends string, TPayload extends object>(
  fields: DomainEvent<TType, TPayload>,
): DomainEvent<TType, Readonly<TPayload>> {
  return Object.freeze({ ...fields, payload: Object.freeze({ ...fields.payload }) });
}
