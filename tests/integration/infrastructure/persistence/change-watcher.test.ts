import type { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { SqliteChangeWatcher } from "../../../../src/infrastructure/persistence/sqlite/change-watcher";
import { openDatabase } from "../../../../src/infrastructure/persistence/sqlite/database";
import { makeTempDir } from "../../../support/temp-dir";
import { testLogger } from "../../../support/test-logger";

let dir: { path: string; cleanup: () => void };
let ours: Database;
let theirs: Database;

function open(path: string): Database {
  const db = openDatabase(path);
  if (!db.ok) throw new Error(db.error.message);
  return db.value;
}

beforeEach(() => {
  dir = makeTempDir();
  const path = join(dir.path, "xuefu.db");
  ours = open(path);
  theirs = open(path);
  ours.run("CREATE TABLE notes (body TEXT)");
});
afterEach(() => {
  ours.close();
  theirs.close();
  dir.cleanup();
});

const POLL_MS = 5;
const settle = () => Bun.sleep(POLL_MS * 6);

describe("SqliteChangeWatcher", () => {
  test("tells when another connection commits, once per change", async () => {
    let changes = 0;
    const stop = new SqliteChangeWatcher(ours, testLogger().logger).watch(() => {
      changes += 1;
    }, POLL_MS);
    await settle();
    expect(changes).toBe(0);

    theirs.run("INSERT INTO notes VALUES ('from the CLI')");
    await settle();
    expect(changes).toBe(1);
    await settle();
    expect(changes).toBe(1);
    stop();
  });

  test("its own connection's commits are not news", async () => {
    let changes = 0;
    const stop = new SqliteChangeWatcher(ours, testLogger().logger).watch(() => {
      changes += 1;
    }, POLL_MS);
    ours.run("INSERT INTO notes VALUES ('from the cockpit')");
    await settle();
    expect(changes).toBe(0);
    stop();
  });

  test("stops when asked", async () => {
    let changes = 0;
    const stop = new SqliteChangeWatcher(ours, testLogger().logger).watch(() => {
      changes += 1;
    }, POLL_MS);
    stop();
    theirs.run("INSERT INTO notes VALUES ('too late')");
    await settle();
    expect(changes).toBe(0);
  });

  test("a database it cannot read is logged once and no longer watched", async () => {
    const { logger, sink } = testLogger();
    const closing = open(join(dir.path, "xuefu.db"));
    let changes = 0;
    const stop = new SqliteChangeWatcher(closing, logger).watch(() => {
      changes += 1;
    }, POLL_MS);
    closing.close();
    await settle();
    expect(changes).toBe(0);
    const stopped = () => sink.records().filter((r) => r.msg === "Stopped watching for changes");
    expect(stopped()).toHaveLength(1);
    stop();

    // Already closed when asked: nothing to watch, and stopping is harmless.
    new SqliteChangeWatcher(closing, logger).watch(() => undefined, POLL_MS)();
    expect(stopped()).toHaveLength(2);
  });
});
