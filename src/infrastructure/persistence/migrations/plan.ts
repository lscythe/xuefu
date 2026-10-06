import { type MigrationError, migrationError } from "../../../domain/shared/errors";
import { err, ok, type Result } from "../../../domain/shared/result";

export interface MigrationDescriptor {
  readonly version: number;
  readonly name: string;
  readonly checksum: string;
}

export interface MigrationPlan {
  readonly currentVersion: number;
  readonly targetVersion: number;
  readonly pending: readonly number[];
}

/**
 * Pure decision of what to run. Applied history must be an exact prefix of the known migrations,
 * with matching checksums; anything else means the database or the binary cannot be trusted.
 */
export function planMigrations(
  known: readonly MigrationDescriptor[],
  applied: readonly MigrationDescriptor[],
): Result<MigrationPlan, MigrationError> {
  for (const [index, migration] of known.entries()) {
    if (migration.version !== index + 1) {
      return err(
        migrationError(
          `Migration list is invalid: expected version ${index + 1}, found ${migration.version}`,
          migration.version,
          "invalid-plan",
        ),
      );
    }
  }

  const targetVersion = known.length;
  const sortedApplied = [...applied].sort((a, b) => a.version - b.version);

  for (const [index, row] of sortedApplied.entries()) {
    if (row.version > targetVersion) {
      return err(
        migrationError(
          `The database is at schema version ${row.version}, but this XueFu only knows ${targetVersion}`,
          row.version,
          "database-newer",
          { hint: "Upgrade XueFu, or restore a backup from the data directory's backups folder." },
        ),
      );
    }
    if (row.version !== index + 1) {
      return err(
        migrationError(
          `Applied migration history has a gap before version ${row.version}`,
          row.version,
          "invalid-plan",
        ),
      );
    }
    const expected = known[index];
    if (expected === undefined || expected.checksum !== row.checksum) {
      return err(
        migrationError(
          `Migration ${row.version} (${row.name}) was modified after it was applied`,
          row.version,
          "checksum-mismatch",
          { hint: "Released migrations must never change; add a new migration instead." },
        ),
      );
    }
  }

  const currentVersion = sortedApplied.length;
  return ok({
    currentVersion,
    targetVersion,
    pending: known.slice(currentVersion).map((m) => m.version),
  });
}
