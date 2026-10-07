import type { Database } from "bun:sqlite";
import { beforeEach, describe, expect, test } from "bun:test";
import type { WorkspaceId } from "../../../../src/domain/shared/ids";
import { MIGRATIONS } from "../../../../src/infrastructure/persistence/migrations/catalog";
import { migrate } from "../../../../src/infrastructure/persistence/migrations/runner";
import { openDatabase } from "../../../../src/infrastructure/persistence/sqlite/database";
import { SqliteWorkspaceTabsRepository } from "../../../../src/infrastructure/persistence/sqlite/workspace-tabs-repository";
import { migratedMemoryDatabase } from "../../../support/database";
import { ManualClock } from "../../../support/manual-clock";

const ids = (...raw: string[]) => raw as WorkspaceId[];

function insertWorkspace(db: Database, id: string, lastActiveAt: number | null = null): void {
  db.run(
    `INSERT INTO workspaces (id, name, path, group_name, position, added_at, last_active_at)
     VALUES (?, ?, ?, NULL, (SELECT count(*) FROM workspaces), 0, ?)`,
    [id, id, `/work/${id}`, lastActiveAt],
  );
}

let db: Database;
let tabs: SqliteWorkspaceTabsRepository;
beforeEach(() => {
  db = migratedMemoryDatabase();
  tabs = new SqliteWorkspaceTabsRepository(db);
  for (const id of ["a", "b", "c"]) insertWorkspace(db, id);
});

describe("SqliteWorkspaceTabsRepository", () => {
  test("nothing is open in a fresh database", () => {
    expect(tabs.load()).toEqual({ ok: true, value: [] });
  });

  test("round-trips tab order, replacing what was saved before", () => {
    expect(tabs.save(ids("c", "a", "b")).ok).toBe(true);
    expect(tabs.load()).toEqual({ ok: true, value: ids("c", "a", "b") });
    expect(tabs.save(ids("b")).ok).toBe(true);
    expect(tabs.load()).toEqual({ ok: true, value: ids("b") });
  });

  test("removing a workspace closes its tab", () => {
    tabs.save(ids("a", "b"));
    db.run("DELETE FROM workspaces WHERE id = 'a'");
    expect(tabs.load()).toEqual({ ok: true, value: ids("b") });
  });

  test("the schema refuses unknown workspaces and more than nine tabs", () => {
    expect(tabs.save(ids("ghost")).ok).toBe(false);
    expect(() =>
      db.run("INSERT INTO workspace_tabs (workspace_id, position) VALUES ('a', 9)"),
    ).toThrow();
    expect(tabs.load()).toEqual({ ok: true, value: [] });
  });

  test("corrupt rows and storage failures surface as storage errors", () => {
    db.run("PRAGMA foreign_keys = OFF");
    db.run("INSERT INTO workspace_tabs (workspace_id, position) VALUES ('Not An Id', 0)");
    expect(tabs.load()).toMatchObject({ ok: false, error: { kind: "storage" } });
    db.close();
    expect(tabs.load()).toMatchObject({ ok: false, error: { operation: "workspace_tabs.read" } });
    expect(tabs.save([])).toMatchObject({ ok: false, error: { operation: "workspace_tabs.save" } });
  });
});

describe("migration 4", () => {
  test("opens the last active workspace as the first tab", () => {
    const opened = openDatabase(":memory:");
    if (!opened.ok) throw new Error(opened.error.message);
    const old = opened.value;
    const clock = new ManualClock();
    migrate(old, MIGRATIONS.slice(0, 3), { clock });
    insertWorkspace(old, "a", 100);
    insertWorkspace(old, "b", 300);
    insertWorkspace(old, "c");
    migrate(old, MIGRATIONS, { clock });
    expect(new SqliteWorkspaceTabsRepository(old).load()).toEqual({ ok: true, value: ids("b") });
  });
});
