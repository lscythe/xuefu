import type { Database } from "bun:sqlite";
import { z } from "zod";
import type {
  EventLedger,
  LedgerPage,
  LedgerQuery,
  StoredEvent,
} from "../../../application/ports/event-ledger";
import {
  type StorageError,
  storageError,
  type ValidationError,
  validationError,
} from "../../../domain/shared/errors";
import type { DomainEvent } from "../../../domain/shared/event";
import { correlationId, eventId, workspaceId } from "../../../domain/shared/ids";
import { err, ok, type Result } from "../../../domain/shared/result";
import { stableStringify } from "../../../domain/shared/stable-json";
import { timestamp } from "../../../domain/shared/time";

const MAX_PAGE_SIZE = 10_000;

const RowSchema = z.object({
  seq: z.int().positive(),
  id: z.string(),
  type: z.string().min(1),
  version: z.int().positive(),
  occurred_at: z.int().nonnegative(),
  workspace_id: z.string().nullable(),
  correlation_id: z.string(),
  payload: z.string(),
});

type Row = z.infer<typeof RowSchema>;

class LedgerCollision extends Error {
  constructor(readonly eventId: string) {
    super(`Event id ${eventId} already exists with different content`);
  }
}

function sameContent(row: Row, event: DomainEvent): boolean {
  return (
    row.type === event.type &&
    row.version === event.version &&
    row.occurred_at === event.occurredAt &&
    row.workspace_id === event.workspaceId &&
    row.correlation_id === event.correlationId &&
    row.payload === stableStringify(event.payload)
  );
}

function corrupt(seq: unknown, cause?: unknown): StorageError {
  return storageError(`Ledger row ${String(seq)} is corrupt`, "ledger.read", {
    context: { seq: typeof seq === "number" ? seq : null },
    ...(cause === undefined ? {} : { cause }),
  });
}

function decodeRow(raw: unknown): Result<StoredEvent, StorageError> {
  const parsed = RowSchema.safeParse(raw);
  if (!parsed.success) return err(corrupt((raw as { seq?: unknown } | null)?.seq));
  const row = parsed.data;
  const id = eventId(row.id);
  const at = timestamp(row.occurred_at);
  const correlation = correlationId(row.correlation_id);
  const workspace = row.workspace_id === null ? ok(null) : workspaceId(row.workspace_id);
  if (!id.ok || !at.ok || !correlation.ok || !workspace.ok) return err(corrupt(row.seq));
  let payload: unknown;
  try {
    payload = JSON.parse(row.payload);
  } catch (thrown) {
    return err(corrupt(row.seq, thrown));
  }
  return ok({
    seq: row.seq,
    id: id.value,
    type: row.type,
    version: row.version,
    occurredAt: at.value,
    workspaceId: workspace.value,
    correlationId: correlation.value,
    payload,
  });
}

export class SqliteEventLedger implements EventLedger {
  constructor(private readonly db: Database) {}

  append(events: readonly DomainEvent[]): Result<void, StorageError> {
    const insert = this.db.query(
      `INSERT INTO events (id, type, version, occurred_at, workspace_id, correlation_id, payload)
       VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT (id) DO NOTHING`,
    );
    const existing = this.db.query("SELECT * FROM events WHERE id = ?");
    // Uses a savepoint when called inside a unit of work, so the outer rollback still applies.
    const appendAll = this.db.transaction((batch: readonly DomainEvent[]) => {
      for (const event of batch) {
        const { changes } = insert.run(
          event.id,
          event.type,
          event.version,
          event.occurredAt,
          event.workspaceId,
          event.correlationId,
          stableStringify(event.payload),
        );
        if (changes === 0) {
          const row = RowSchema.safeParse(existing.get(event.id));
          if (!row.success || !sameContent(row.data, event)) throw new LedgerCollision(event.id);
        }
      }
    });

    try {
      appendAll(events);
      return ok(undefined);
    } catch (thrown) {
      if (thrown instanceof LedgerCollision) {
        return err(
          storageError(thrown.message, "ledger.append", { context: { eventId: thrown.eventId } }),
        );
      }
      return err(
        storageError("Unable to append to the activity ledger", "ledger.append", { cause: thrown }),
      );
    }
  }

  list(query: LedgerQuery): Result<LedgerPage, StorageError | ValidationError> {
    if (!Number.isSafeInteger(query.limit) || query.limit < 1 || query.limit > MAX_PAGE_SIZE) {
      return err(
        validationError("Invalid page size", [
          { path: "limit", message: `must be an integer between 1 and ${MAX_PAGE_SIZE}` },
        ]),
      );
    }

    const clauses: string[] = [];
    const params: (string | number)[] = [];
    if (query.workspaceId !== undefined) {
      clauses.push("workspace_id = ?");
      params.push(query.workspaceId);
    }
    if (query.from !== undefined) {
      clauses.push("occurred_at >= ?");
      params.push(query.from);
    }
    if (query.to !== undefined) {
      clauses.push("occurred_at < ?");
      params.push(query.to);
    }
    if (query.afterSeq !== undefined) {
      clauses.push("seq > ?");
      params.push(query.afterSeq);
    }
    const where = clauses.length === 0 ? "" : `WHERE ${clauses.join(" AND ")}`;

    let rows: unknown[];
    try {
      rows = this.db
        .query(`SELECT * FROM events ${where} ORDER BY seq LIMIT ?`)
        .all(...params, query.limit + 1);
    } catch (thrown) {
      return err(
        storageError("Unable to read the activity ledger", "ledger.read", { cause: thrown }),
      );
    }

    const events: StoredEvent[] = [];
    for (const raw of rows.slice(0, query.limit)) {
      const decoded = decodeRow(raw);
      if (!decoded.ok) return decoded;
      events.push(decoded.value);
    }
    const hasMore = rows.length > query.limit;
    return ok({ events, nextCursor: hasMore ? (events.at(-1)?.seq ?? null) : null });
  }
}
