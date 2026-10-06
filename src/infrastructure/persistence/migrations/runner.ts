import type { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import type { Clock } from "../../../application/ports/clock";
import { type MigrationError, migrationError } from "../../../domain/shared/errors";
import { err, fromThrowable, ok, type Result } from "../../../domain/shared/result";
import type { Migration } from "./migration";
import { type MigrationDescriptor, planMigrations } from "./plan";

export interface MigrateOptions {
  readonly clock: Clock;
  /** When set, an existing database is copied here before any pending migration runs. */
  readonly backupDir?: string;
}

export interface MigrationReport {
  readonly fromVersion: number;
  readonly toVersion: number;
  readonly applied: readonly number[];
  readonly backupPath: string | null;
}

const AppliedRowSchema = z.object({
  version: z.int().positive(),
  name: z.string(),
  checksum: z.string(),
});

function checksum(sql: string): string {
  return new Bun.CryptoHasher("sha256").update(sql).digest("hex");
}

function compactTimestamp(epochMs: number): string {
  return new Date(epochMs)
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "");
}

function readApplied(db: Database): Result<MigrationDescriptor[], MigrationError> {
  return fromThrowable(
    () => {
      db.run(`CREATE TABLE IF NOT EXISTS schema_migrations (
        version    INTEGER PRIMARY KEY,
        name       TEXT    NOT NULL,
        checksum   TEXT    NOT NULL,
        applied_at INTEGER NOT NULL
      ) STRICT`);
      const rows = db.query("SELECT version, name, checksum FROM schema_migrations").all();
      return z.array(AppliedRowSchema).parse(rows);
    },
    (thrown) => migrationError("Unable to read migration history", 0, "failed", { cause: thrown }),
  );
}

function backup(
  db: Database,
  dir: string,
  fromVersion: number,
  clock: Clock,
): Result<string, MigrationError> {
  const path = join(dir, `xuefu-v${fromVersion}-${compactTimestamp(clock.now())}.db`);
  return fromThrowable(
    () => {
      mkdirSync(dir, { recursive: true, mode: 0o700 });
      db.run("VACUUM INTO ?", [path]);
      return path;
    },
    (thrown) =>
      migrationError(
        "Unable to back up the database before migrating",
        fromVersion,
        "backup-failed",
        {
          cause: thrown,
          context: { path },
          hint: "Free disk space or fix permissions on the backups directory; nothing was changed.",
        },
      ),
  );
}

function applyOne(
  db: Database,
  migration: Migration,
  appliedAt: number,
): Result<void, MigrationError> {
  try {
    db.run("BEGIN IMMEDIATE");
    // Re-check inside the write lock: another XueFu process may have migrated meanwhile.
    const already = db
      .query("SELECT 1 FROM schema_migrations WHERE version = ?")
      .get(migration.version);
    if (already === null) {
      db.run(migration.sql);
      db.run(
        "INSERT INTO schema_migrations (version, name, checksum, applied_at) VALUES (?, ?, ?, ?)",
        [migration.version, migration.name, checksum(migration.sql), appliedAt],
      );
    }
    db.run("COMMIT");
    return ok(undefined);
  } catch (thrown) {
    if (db.inTransaction) db.run("ROLLBACK");
    return err(
      migrationError(
        `Migration ${migration.version} (${migration.name}) failed and was rolled back`,
        migration.version,
        "failed",
        { cause: thrown },
      ),
    );
  }
}

/** Brings the schema to the latest version, one transaction per migration. */
export function migrate(
  db: Database,
  migrations: readonly Migration[],
  options: MigrateOptions,
): Result<MigrationReport, MigrationError> {
  const applied = readApplied(db);
  if (!applied.ok) return applied;

  const known = migrations.map((m) => ({
    version: m.version,
    name: m.name,
    checksum: checksum(m.sql),
  }));
  const plan = planMigrations(known, applied.value);
  if (!plan.ok) return plan;

  const { currentVersion, targetVersion, pending } = plan.value;
  if (pending.length === 0) {
    return ok({
      fromVersion: currentVersion,
      toVersion: targetVersion,
      applied: [],
      backupPath: null,
    });
  }

  let backupPath: string | null = null;
  if (options.backupDir !== undefined && currentVersion > 0) {
    const copied = backup(db, options.backupDir, currentVersion, options.clock);
    if (!copied.ok) return copied;
    backupPath = copied.value;
  }

  const done: number[] = [];
  for (const version of pending) {
    const migration = migrations[version - 1];
    if (migration === undefined) {
      return err(migrationError(`Migration ${version} is missing`, version, "invalid-plan"));
    }
    const result = applyOne(db, migration, options.clock.now());
    if (!result.ok) return result;
    done.push(version);
  }
  return ok({ fromVersion: currentVersion, toVersion: targetVersion, applied: done, backupPath });
}
