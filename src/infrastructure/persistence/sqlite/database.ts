import { Database } from "bun:sqlite";
import { chmodSync } from "node:fs";
import { type StorageError, storageError } from "../../../domain/shared/errors";
import { fromThrowable, type Result } from "../../../domain/shared/result";

const BUSY_TIMEOUT_MS = 5000;

/**
 * Opens the XueFu database. WAL lets the TUI and a concurrent CLI invocation share the file;
 * synchronous=FULL because activity history must survive crashes and power loss.
 */
export function openDatabase(path: string): Result<Database, StorageError> {
  return fromThrowable(
    () => {
      const db = new Database(path, { create: true, strict: true });
      db.run(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS}`);
      db.run("PRAGMA journal_mode = WAL");
      db.run("PRAGMA synchronous = FULL");
      db.run("PRAGMA foreign_keys = ON");
      if (path !== ":memory:") chmodSync(path, 0o600);
      return db;
    },
    (thrown) =>
      storageError("Unable to open the XueFu database", "open", {
        cause: thrown,
        context: { path },
        hint: "Check that the data directory exists and is writable, then run `xuefu diagnostics`.",
      }),
  );
}
