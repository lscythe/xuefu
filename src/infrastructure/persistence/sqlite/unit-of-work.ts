import type { Database } from "bun:sqlite";
import type { EventLedger } from "../../../application/ports/event-ledger";
import type { EventPublisher } from "../../../application/ports/event-publisher";
import type { Transaction, UnitOfWork } from "../../../application/ports/unit-of-work";
import {
  type StorageError,
  storageError,
  type UnexpectedError,
  unexpected,
} from "../../../domain/shared/errors";
import type { DomainEvent } from "../../../domain/shared/event";
import { err, type Result } from "../../../domain/shared/result";

export class SqliteUnitOfWork implements UnitOfWork {
  constructor(
    private readonly db: Database,
    private readonly ledger: EventLedger,
    private readonly publisher: EventPublisher,
  ) {}

  async run<T, E>(
    work: (tx: Transaction) => Result<T, E>,
  ): Promise<Result<T, E | StorageError | UnexpectedError>> {
    if (this.db.inTransaction) {
      return err(storageError("Nested units of work are not supported", "transaction.begin"));
    }

    const recorded: DomainEvent[] = [];
    let open = true;
    const tx: Transaction = {
      record: (event) => {
        // A leaked handle would let events bypass the transaction; that is a programming error.
        if (!open) throw new Error("Transaction is closed");
        recorded.push(event);
      },
    };

    try {
      this.db.run("BEGIN IMMEDIATE");
    } catch (thrown) {
      open = false;
      return err(
        storageError("Unable to start a transaction", "transaction.begin", { cause: thrown }),
      );
    }

    let outcome: Result<T, E>;
    try {
      outcome = work(tx);
      if (!outcome.ok) return this.rollback(outcome);
      const appended = this.ledger.append(recorded);
      if (!appended.ok) return this.rollback(appended);
    } catch (thrown) {
      return this.rollback(err(unexpected("Unit of work failed", thrown)));
    } finally {
      open = false;
    }

    try {
      this.db.run("COMMIT");
    } catch (thrown) {
      return this.rollback(
        err(
          storageError("Unable to commit the transaction", "transaction.commit", { cause: thrown }),
        ),
      );
    }

    await this.publisher.publish(recorded);
    return outcome;
  }

  private rollback<R extends { ok: false }>(failure: R): R | Result<never, StorageError> {
    if (!this.db.inTransaction) return failure;
    try {
      this.db.run("ROLLBACK");
      return failure;
    } catch (thrown) {
      return err(
        storageError(
          "Rollback failed after an error; the database connection must be reopened",
          "transaction.rollback",
          {
            cause: thrown,
          },
        ),
      );
    }
  }
}
