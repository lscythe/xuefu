import type { Database } from "bun:sqlite";
import { MIGRATIONS } from "../../src/infrastructure/persistence/migrations/catalog";
import { migrate } from "../../src/infrastructure/persistence/migrations/runner";
import { openDatabase } from "../../src/infrastructure/persistence/sqlite/database";
import { ManualClock } from "./manual-clock";

/** Fully migrated in-memory database. */
export function migratedMemoryDatabase(): Database {
  const db = openDatabase(":memory:");
  if (!db.ok) throw new Error(db.error.message);
  const migrated = migrate(db.value, MIGRATIONS, { clock: new ManualClock() });
  if (!migrated.ok) throw new Error(migrated.error.message);
  return db.value;
}
