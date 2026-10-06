import type { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { MIGRATIONS } from "../../../../src/infrastructure/persistence/migrations/catalog";
import type { Migration } from "../../../../src/infrastructure/persistence/migrations/migration";
import { migrate } from "../../../../src/infrastructure/persistence/migrations/runner";
import { openDatabase } from "../../../../src/infrastructure/persistence/sqlite/database";
import { ManualClock } from "../../../support/manual-clock";
import { makeTempDir } from "../../../support/temp-dir";

let dir: { path: string; cleanup: () => void };
const opened: Database[] = [];
beforeEach(() => {
  dir = makeTempDir();
});
afterEach(() => {
  for (const db of opened.splice(0)) db.close();
  dir.cleanup();
});

function open(name = "xuefu.db"): Database {
  const result = openDatabase(join(dir.path, name));
  if (!result.ok) throw new Error(result.error.message);
  opened.push(result.value);
  return result.value;
}

const clock = new ManualClock(Date.UTC(2026, 9, 6, 12, 0, 0));
const run = (db: Database, migrations: readonly Migration[], backupDir?: string) =>
  migrate(db, migrations, { clock, ...(backupDir === undefined ? {} : { backupDir }) });

const m1: Migration = {
  version: 1,
  name: "create notes",
  sql: "CREATE TABLE notes (id INTEGER PRIMARY KEY, body TEXT NOT NULL) STRICT;",
};
const m2: Migration = {
  version: 2,
  name: "add tags",
  sql: "CREATE TABLE tags (note_id INTEGER NOT NULL REFERENCES notes(id), tag TEXT NOT NULL) STRICT;",
};

function tables(db: Database): string[] {
  return db
    .query<{ name: string }, []>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    )
    .all()
    .map((r) => r.name);
}

function appliedVersions(db: Database): number[] {
  return db
    .query<{ version: number }, []>("SELECT version FROM schema_migrations ORDER BY version")
    .all()
    .map((r) => r.version);
}

function schemaOf(db: Database): string[] {
  return db
    .query<{ type: string; name: string; sql: string | null }, []>(
      "SELECT type, name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' AND name != 'schema_migrations' ORDER BY type, name",
    )
    .all()
    .map((r) => `${r.type}:${r.name}:${(r.sql ?? "").replace(/\s+/g, " ")}`);
}

describe("openDatabase", () => {
  test("enables WAL, foreign keys, full sync and a busy timeout", () => {
    const db = open();
    expect(db.query("PRAGMA journal_mode").get()).toEqual({ journal_mode: "wal" });
    expect(db.query("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 });
    expect(db.query("PRAGMA synchronous").get()).toEqual({ synchronous: 2 });
    expect(db.query("PRAGMA busy_timeout").get()).toEqual({ timeout: 5000 });
  });

  test("the database file is private to the user", () => {
    open();
    expect(statSync(join(dir.path, "xuefu.db")).mode & 0o777).toBe(0o600);
  });

  test("reports a storage error when the file cannot be opened", () => {
    const result = openDatabase(join(dir.path, "missing-dir", "x.db"));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("storage");
  });
});

describe("migrate", () => {
  test("applies pending migrations in order and records them", () => {
    const db = open();
    const result = run(db, [m1, m2]);
    expect(result).toEqual({
      ok: true,
      value: { fromVersion: 0, toVersion: 2, applied: [1, 2], backupPath: null },
    });
    expect(tables(db)).toEqual(["notes", "schema_migrations", "tags"]);
    expect(appliedVersions(db)).toEqual([1, 2]);
  });

  test("invariant: migrations execute exactly once", () => {
    const db = open();
    run(db, [m1]);
    const second = run(db, [m1]);
    expect(second.ok && second.value.applied).toEqual([]);
    expect(appliedVersions(db)).toEqual([1]);
  });

  test("invariant: a failed migration leaves no partial schema and earlier ones stay applied", () => {
    const db = open();
    const broken: Migration = {
      version: 2,
      name: "broken",
      sql: "CREATE TABLE half (x INTEGER) STRICT; INSERT INTO does_not_exist VALUES (1);",
    };
    const result = run(db, [m1, broken]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.reason).toBe("failed");
      expect(result.error.version).toBe(2);
      expect(result.error.cause?.message).toContain("does_not_exist");
    }
    expect(tables(db)).toEqual(["notes", "schema_migrations"]);
    expect(appliedVersions(db)).toEqual([1]);
    expect(db.inTransaction).toBe(false);
  });

  test("refuses to run when an applied migration was edited", () => {
    const db = open();
    run(db, [m1]);
    const edited = { ...m1, sql: `${m1.sql} -- edited` };
    const result = run(db, [edited, m2]);
    expect(!result.ok && result.error.reason).toBe("checksum-mismatch");
    expect(tables(db)).not.toContain("tags");
  });

  test("refuses a database created by a newer XueFu", () => {
    const db = open();
    run(db, [m1, m2]);
    const result = run(db, [m1]);
    expect(!result.ok && result.error.reason).toBe("database-newer");
  });

  test("backs up an existing database before upgrading it", () => {
    const db = open();
    run(db, [m1]);
    db.run("INSERT INTO notes (body) VALUES ('keep me')");
    const backupDir = join(dir.path, "backups");
    const result = run(db, [m1, m2], backupDir);
    expect(result.ok).toBe(true);
    const backupPath = result.ok ? result.value.backupPath : null;
    expect(backupPath).toBe(join(backupDir, "xuefu-v1-20261006T120000Z.db"));
    expect(existsSync(backupPath ?? "")).toBe(true);

    const backup = openDatabase(backupPath ?? "");
    if (!backup.ok) throw new Error("backup unreadable");
    opened.push(backup.value);
    expect(appliedVersions(backup.value)).toEqual([1]);
    expect(backup.value.query("SELECT body FROM notes").all()).toEqual([{ body: "keep me" }]);
  });

  test("does not create a backup for a fresh database or when nothing is pending", () => {
    const db = open();
    const backupDir = join(dir.path, "backups");
    run(db, [m1], backupDir);
    run(db, [m1], backupDir);
    expect(existsSync(backupDir) ? readdirSync(backupDir) : []).toEqual([]);
  });

  test("upgrading from every previous version yields the same schema as a fresh install", () => {
    const fresh = open("fresh.db");
    expect(run(fresh, MIGRATIONS).ok).toBe(true);
    const expected = schemaOf(fresh);

    for (let k = 0; k <= MIGRATIONS.length; k += 1) {
      const db = open(`from-v${k}.db`);
      expect(run(db, MIGRATIONS.slice(0, k)).ok).toBe(true);
      expect(run(db, MIGRATIONS).ok).toBe(true);
      expect(schemaOf(db)).toEqual(expected);
      expect(appliedVersions(db)).toEqual(MIGRATIONS.map((m) => m.version));
    }
  });
});
