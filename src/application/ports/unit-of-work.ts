import type { StorageError, UnexpectedError } from "../../domain/shared/errors";
import type { DomainEvent } from "../../domain/shared/event";
import type { Result } from "../../domain/shared/result";

export interface Transaction {
  /** Appends to the ledger in the same transaction; published to subscribers after commit. */
  record(event: DomainEvent): void;
}

/**
 * Atomic local state change. `work` is synchronous on purpose: remote I/O cannot happen while the
 * database write lock is held. Returning an error (or throwing) rolls everything back.
 */
export interface UnitOfWork {
  run<T, E>(
    work: (tx: Transaction) => Result<T, E>,
  ): Promise<Result<T, E | StorageError | UnexpectedError>>;
}
