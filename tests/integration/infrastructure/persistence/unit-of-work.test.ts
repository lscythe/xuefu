import type { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { EventBus } from "../../../../src/application/events/event-bus";
import type { DomainEvent } from "../../../../src/domain/shared/event";
import { err, ok } from "../../../../src/domain/shared/result";
import { SqliteEventLedger } from "../../../../src/infrastructure/persistence/sqlite/event-ledger";
import { SqliteUnitOfWork } from "../../../../src/infrastructure/persistence/sqlite/unit-of-work";
import { migratedMemoryDatabase } from "../../../support/database";
import { testEvent } from "../../../support/events";
import { testLogger } from "../../../support/test-logger";

let db: Database;
let ledger: SqliteEventLedger;
let bus: EventBus;
let published: DomainEvent[];
let uow: SqliteUnitOfWork;

beforeEach(() => {
  db = migratedMemoryDatabase();
  db.run("CREATE TABLE counters (name TEXT PRIMARY KEY, value INTEGER NOT NULL) STRICT");
  ledger = new SqliteEventLedger(db);
  bus = new EventBus(testLogger().logger);
  published = [];
  bus.subscribe("*", (e) => void published.push(e));
  uow = new SqliteUnitOfWork(db, ledger, bus);
});
afterEach(() => db.close());

const storedIds = () => {
  const page = ledger.list({ limit: 100 });
  return page.ok ? page.value.events.map((e) => e.id) : [];
};
const counter = () =>
  db.query<{ value: number }, []>("SELECT value FROM counters WHERE name = 'c'").get()?.value ??
  null;

describe("SqliteUnitOfWork", () => {
  test("commits state and recorded events together, then publishes", async () => {
    const event = testEvent();
    const result = await uow.run((tx) => {
      db.run("INSERT INTO counters VALUES ('c', 1)");
      tx.record(event);
      return ok("done");
    });
    expect(result).toEqual(ok("done"));
    expect(counter()).toBe(1);
    expect(storedIds()).toEqual([event.id]);
    expect(published.map((e) => e.id)).toEqual([event.id]);
  });

  test("a returned error rolls back state and events and publishes nothing", async () => {
    const result = await uow.run((tx) => {
      db.run("INSERT INTO counters VALUES ('c', 1)");
      tx.record(testEvent());
      return err({ kind: "validation" as const, message: "nope" });
    });
    expect(result.ok).toBe(false);
    expect(counter()).toBeNull();
    expect(storedIds()).toEqual([]);
    expect(published).toEqual([]);
  });

  test("a thrown exception rolls back and becomes an unexpected error", async () => {
    const result = await uow.run<never, never>((tx) => {
      db.run("INSERT INTO counters VALUES ('c', 1)");
      tx.record(testEvent());
      throw new Error("handler bug");
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("unexpected");
    expect(counter()).toBeNull();
    expect(storedIds()).toEqual([]);
    expect(db.inTransaction).toBe(false);
  });

  test("a ledger failure rolls back the state change", async () => {
    const existing = testEvent();
    ledger.append([existing]);
    const result = await uow.run<undefined, never>((tx) => {
      db.run("INSERT INTO counters VALUES ('c', 1)");
      tx.record({ ...existing, payload: { issueKey: "COLLIDES-1" } });
      return ok(undefined);
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("storage");
    expect(counter()).toBeNull();
    expect(published).toEqual([]);
  });

  test("nested units of work are rejected", async () => {
    let inner: Awaited<ReturnType<typeof uow.run>> | undefined;
    await uow.run(() => {
      void uow
        .run(() => ok(1))
        .then((r) => {
          inner = r;
        });
      return ok(undefined);
    });
    await Bun.sleep(0);
    expect(inner?.ok).toBe(false);
  });

  test("a transaction handle cannot be used after the unit of work ends", async () => {
    let leaked: { record: (e: DomainEvent) => void } | undefined;
    await uow.run((tx) => {
      leaked = tx;
      return ok(undefined);
    });
    expect(() => leaked?.record(testEvent())).toThrow("closed");
  });

  test("subscriber failures do not undo a committed unit of work", async () => {
    bus.subscribe("*", () => {
      throw new Error("projection failed");
    });
    const event = testEvent();
    const result = await uow.run((tx) => {
      tx.record(event);
      return ok(undefined);
    });
    expect(result.ok).toBe(true);
    expect(storedIds()).toEqual([event.id]);
  });
});
