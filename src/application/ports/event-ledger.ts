import type { StorageError, ValidationError } from "../../domain/shared/errors";
import type { DomainEvent } from "../../domain/shared/event";
import type { WorkspaceId } from "../../domain/shared/ids";
import type { Result } from "../../domain/shared/result";
import type { Timestamp } from "../../domain/shared/time";

export interface StoredEvent extends DomainEvent {
  /** Monotonic ledger position; the pagination cursor. */
  readonly seq: number;
}

export interface LedgerQuery {
  readonly workspaceId?: WorkspaceId;
  /** Inclusive lower bound on occurredAt. */
  readonly from?: Timestamp;
  /** Exclusive upper bound on occurredAt. */
  readonly to?: Timestamp;
  readonly afterSeq?: number;
  readonly beforeSeq?: number;
  /** Latest events first; continue with `beforeSeq: nextCursor`. Oldest first otherwise. */
  readonly newestFirst?: boolean;
  readonly limit: number;
}

export interface LedgerPage {
  readonly events: readonly StoredEvent[];
  readonly nextCursor: number | null;
}

/** Durable, append-only activity history. */
export interface EventLedger {
  /** All-or-nothing; re-appending an identical event is a no-op. */
  append(events: readonly DomainEvent[]): Result<void, StorageError>;
  list(query: LedgerQuery): Result<LedgerPage, StorageError | ValidationError>;
}
