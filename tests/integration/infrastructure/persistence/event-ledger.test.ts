import type { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { WorkspaceId } from "../../../../src/domain/shared/ids";
import type { Timestamp } from "../../../../src/domain/shared/time";
import { SqliteEventLedger } from "../../../../src/infrastructure/persistence/sqlite/event-ledger";
import { migratedMemoryDatabase } from "../../../support/database";
import { testEvent } from "../../../support/events";

let db: Database;
let ledger: SqliteEventLedger;
beforeEach(() => {
  db = migratedMemoryDatabase();
  ledger = new SqliteEventLedger(db);
});
afterEach(() => db.close());

const list = (query: Parameters<SqliteEventLedger["list"]>[0]) => {
  const result = ledger.list(query);
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
};

describe("SqliteEventLedger", () => {
  test("round-trips events with their payloads", () => {
    const event = testEvent({ payload: { issueKey: "MOB-2841", nested: { n: 1 } } });
    expect(ledger.append([event])).toEqual({ ok: true, value: undefined });
    const page = list({ limit: 10 });
    expect(page.events).toEqual([{ ...event, seq: 1 }]);
    expect(page.nextCursor).toBeNull();
  });

  test("appending the same event twice is idempotent", () => {
    const event = testEvent();
    ledger.append([event]);
    expect(ledger.append([event]).ok).toBe(true);
    expect(list({ limit: 10 }).events).toHaveLength(1);
  });

  test("identical content with different key order is still idempotent", () => {
    const event = testEvent({ payload: { a: 1, b: 2 } });
    ledger.append([event]);
    expect(ledger.append([{ ...event, payload: { b: 2, a: 1 } }]).ok).toBe(true);
  });

  test("an id collision with different content is a storage error", () => {
    const event = testEvent();
    ledger.append([event]);
    const result = ledger.append([{ ...event, payload: { issueKey: "OTHER-1" } }]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("storage");
      expect(result.error.context["eventId"]).toBe(event.id);
    }
  });

  test("a batch is all-or-nothing", () => {
    const first = testEvent();
    ledger.append([first]);
    const fresh = testEvent();
    const collision = { ...first, payload: { issueKey: "OTHER-1" } };
    expect(ledger.append([fresh, collision]).ok).toBe(false);
    expect(list({ limit: 10 }).events.map((e) => e.id)).toEqual([first.id]);
  });

  test("invariant: history is append-only at the database level", () => {
    ledger.append([testEvent()]);
    expect(() => db.run("UPDATE events SET type = 'x'")).toThrow("append-only");
    expect(() => db.run("DELETE FROM events")).toThrow("append-only");
  });

  test("filters by workspace and time range, ordered by sequence", () => {
    const mobile = "mobile-banking" as WorkspaceId;
    const auth = "auth-service" as WorkspaceId;
    const at = (t: number) => t as Timestamp;
    const events = [
      testEvent({ workspaceId: mobile, occurredAt: at(100) }),
      testEvent({ workspaceId: auth, occurredAt: at(150) }),
      testEvent({ workspaceId: mobile, occurredAt: at(200) }),
      testEvent({ workspaceId: mobile, occurredAt: at(300) }),
      testEvent({ workspaceId: null, occurredAt: at(250) }),
    ];
    ledger.append(events);
    const page = list({ workspaceId: mobile, from: at(150), to: at(300), limit: 10 });
    const third = events[2];
    if (third === undefined) throw new Error("fixture");
    expect(page.events).toEqual([{ ...third, seq: 3 }]);
  });

  test("paginates with a stable cursor", () => {
    const events = Array.from({ length: 5 }, () => testEvent());
    ledger.append(events);
    const first = list({ limit: 2 });
    expect(first.events.map((e) => e.seq)).toEqual([1, 2]);
    expect(first.nextCursor).toBe(2);
    const second = list({ limit: 2, afterSeq: first.nextCursor ?? 0 });
    expect(second.events.map((e) => e.seq)).toEqual([3, 4]);
    const last = list({ limit: 2, afterSeq: second.nextCursor ?? 0 });
    expect(last.events.map((e) => e.seq)).toEqual([5]);
    expect(last.nextCursor).toBeNull();
  });

  test("rejects unreasonable page sizes", () => {
    expect(ledger.list({ limit: 0 }).ok).toBe(false);
    expect(ledger.list({ limit: 10_001 }).ok).toBe(false);
  });

  test("handles thousands of events and Unicode payloads", () => {
    const events = Array.from({ length: 2_000 }, (_, i) =>
      testEvent({ payload: { note: `血符 ${i} 🔥`, issueKey: "MOB-1" } }),
    );
    expect(ledger.append(events).ok).toBe(true);
    const page = list({ limit: 1_000, afterSeq: 1_000 });
    expect(page.events[0]?.payload).toEqual({ note: "血符 1000 🔥", issueKey: "MOB-1" });
  });
});
