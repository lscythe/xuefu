import type { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { RECORDED_EVENTS } from "../../../src/application/activity/describe";
import { ActivityQueries } from "../../../src/application/activity/queries";
import { EventCatalog } from "../../../src/application/events/catalog";
import type { WorkspaceId } from "../../../src/domain/shared/ids";
import { SqliteEventLedger } from "../../../src/infrastructure/persistence/sqlite/event-ledger";
import { SqliteWorkspaceRepository } from "../../../src/infrastructure/persistence/sqlite/workspace-repository";
import { migratedMemoryDatabase } from "../../support/database";
import { testEvent } from "../../support/events";

let db: Database;
let ledger: SqliteEventLedger;
let activity: ActivityQueries;

beforeEach(() => {
  db = migratedMemoryDatabase();
  db.run(
    `INSERT INTO workspaces (id, name, path, group_name, position, added_at)
     VALUES ('mobile-banking', 'Mobile Banking', '/work/mobile-banking', NULL, 0, 0)`,
  );
  ledger = new SqliteEventLedger(db);
  const catalog = EventCatalog.create(RECORDED_EVENTS);
  if (!catalog.ok) throw new Error(catalog.error.message);
  activity = new ActivityQueries(ledger, new SqliteWorkspaceRepository(db), catalog.value);
});
afterEach(() => db.close());

const mobile = "mobile-banking" as WorkspaceId;
const removed = "auth-service" as WorkspaceId;

function record(type: string, payload: object, workspaceId: WorkspaceId | null = mobile) {
  const appended = ledger.append([testEvent({ type, payload, workspaceId })]);
  if (!appended.ok) throw new Error(appended.error.message);
}

function recent(query: Parameters<ActivityQueries["recent"]>[0]) {
  const page = activity.recent(query);
  if (!page.ok) throw new Error(page.error.message);
  return page.value;
}

describe("ActivityQueries.recent", () => {
  test("newest first, each event described, with its workspace", () => {
    record("WorkStarted", { workId: "w", workspaceId: mobile, issueKey: "MOB-1", title: null });
    record("TimerStarted", { timerId: "t", workspaceId: mobile, issueKey: "MOB-1" });
    const page = recent({ limit: 10 });
    expect(page.nextCursor).toBeNull();
    expect(page.entries).toMatchObject([
      {
        seq: 2,
        workspaceId: mobile,
        workspace: { name: "Mobile Banking" },
        description: { action: "Started the timer for", subject: { text: "MOB-1" } },
      },
      { seq: 1, description: { action: "Started work on" } },
    ]);
    expect(typeof page.entries[0]?.at).toBe("number");
  });

  test("a removed workspace keeps its history, without a workspace to show", () => {
    record("WorkspaceRemoved", { id: removed, name: "Auth", path: "/auth" }, removed);
    record("FromTheFuture", {}, null);
    expect(recent({ limit: 10 }).entries).toMatchObject([
      { workspaceId: null, workspace: null, description: { action: "Unrecognised event" } },
      { workspaceId: removed, workspace: null, description: { action: "Removed" } },
    ]);
  });

  test("filters by workspace and pages back through older entries", () => {
    for (let i = 0; i < 3; i += 1) record("WorkspaceActivated", { id: mobile });
    record("WorkspaceActivated", { id: removed }, removed);
    const first = recent({ workspaceId: mobile, limit: 2 });
    expect(first.entries.map((e) => e.seq)).toEqual([3, 2]);
    expect(first.nextCursor).toBe(2);
    const rest = recent({ workspaceId: mobile, limit: 2, before: 2 });
    expect(rest.entries.map((e) => e.seq)).toEqual([1]);
    expect(rest.nextCursor).toBeNull();
  });

  test("storage failures and bad page sizes are errors", () => {
    expect(activity.recent({ limit: 0 })).toMatchObject({
      ok: false,
      error: { kind: "validation" },
    });
    db.run("DROP TABLE workspaces");
    expect(activity.recent({ limit: 10 })).toMatchObject({ ok: false, error: { kind: "storage" } });
    db.run("DROP TABLE events");
    expect(activity.recent({ limit: 10 })).toMatchObject({ ok: false, error: { kind: "storage" } });
  });
});
