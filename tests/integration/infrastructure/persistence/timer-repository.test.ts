import type { Database } from "bun:sqlite";
import { beforeEach, describe, expect, test } from "bun:test";
import type { TimerId, WorkspaceId } from "../../../../src/domain/shared/ids";
import type { Result } from "../../../../src/domain/shared/result";
import type { Timestamp } from "../../../../src/domain/shared/time";
import {
  pauseTimer,
  resumeTimer,
  startTimer,
  stopTimer,
  type Timer,
} from "../../../../src/domain/timesheet/timer";
import type { IssueKey } from "../../../../src/domain/work/issue-key";
import { SqliteTimerRepository } from "../../../../src/infrastructure/persistence/sqlite/timer-repository";
import { migratedMemoryDatabase } from "../../../support/database";

const at = (seconds: number) => (1_760_000_000_000 + seconds * 1000) as Timestamp;
const unwrap = <T>(result: Result<T, unknown>): T => {
  if (!result.ok) throw new Error("expected ok");
  return result.value;
};
const timer = (id: string, issue: string | null = null) =>
  startTimer(
    {
      id: id as TimerId,
      workspaceId: "mobile-banking" as WorkspaceId,
      issueKey: issue as IssueKey | null,
    },
    at(0),
  );

let db: Database;
let timers: SqliteTimerRepository;
beforeEach(() => {
  db = migratedMemoryDatabase();
  timers = new SqliteTimerRepository(db);
});

describe("SqliteTimerRepository", () => {
  test("round-trips the active timer with its segments", () => {
    expect(timers.active()).toEqual({ ok: true, value: null });
    let saved: Timer = timer("t1", "MOB-2841");
    timers.save(saved);
    expect(timers.active()).toEqual({ ok: true, value: saved });

    saved = unwrap(resumeTimer(unwrap(pauseTimer(saved, at(60))), at(90)));
    timers.save(saved);
    expect(timers.active()).toEqual({ ok: true, value: saved });

    saved = unwrap(pauseTimer(saved, at(100)));
    timers.save(saved);
    expect(timers.active()).toEqual({ ok: true, value: saved });
  });

  test("stopped timers are kept but are not active", () => {
    timers.save(unwrap(stopTimer(timer("t1"), at(30))));
    expect(timers.active()).toEqual({ ok: true, value: null });
    expect(db.query("SELECT status FROM timers").all()).toEqual([{ status: "stopped" }]);
    expect(db.query("SELECT count(*) AS n FROM timer_segments").get()).toEqual({ n: 1 });
  });

  test("storage refuses a second running or paused timer", () => {
    timers.save(timer("t1"));
    expect(timers.save(unwrap(pauseTimer(timer("t2"), at(1))))).toMatchObject({
      ok: false,
      error: { kind: "storage", operation: "timers.save" },
    });
    // The failed save left nothing behind.
    expect(db.query("SELECT id FROM timers").all()).toEqual([{ id: "t1" }]);
    timers.save(unwrap(stopTimer(timer("t1"), at(5))));
    expect(timers.save(timer("t2")).ok).toBe(true);
  });

  test("corrupt rows surface as storage errors", () => {
    timers.save(timer("t1"));
    db.run("UPDATE timer_segments SET end_at = start_at");
    expect(timers.active()).toMatchObject({
      ok: false,
      error: { kind: "storage", message: "A stored timer is corrupt" },
    });
    db.run("UPDATE timers SET issue_key = 'not a key'");
    expect(timers.active()).toMatchObject({ ok: false, error: { operation: "timers.read" } });
    db.run("UPDATE timers SET issue_key = NULL, workspace_id = 'Bad Id'");
    expect(timers.active().ok).toBe(false);
  });

  test("segment rows that are not numbers are corrupt", () => {
    const fresh = migratedMemoryDatabase();
    // A non-STRICT copy lets a wrong type in, as an older or hand-edited database might.
    fresh.run("DROP TABLE timer_segments");
    fresh.run("CREATE TABLE timer_segments (timer_id, position, start_at, end_at)");
    const repository = new SqliteTimerRepository(fresh);
    repository.save(timer("t1"));
    fresh.run("UPDATE timer_segments SET start_at = 'soon'");
    expect(repository.active()).toMatchObject({ ok: false, error: { kind: "storage" } });
    fresh.run("UPDATE timer_segments SET start_at = 0, end_at = -5");
    expect(repository.active()).toMatchObject({ ok: false, error: { kind: "storage" } });
  });

  test("a closed database reports read and save failures", () => {
    db.close();
    expect(timers.active()).toMatchObject({ ok: false, error: { operation: "timers.read" } });
    expect(timers.save(timer("t1"))).toMatchObject({
      ok: false,
      error: { operation: "timers.save" },
    });
  });
});
