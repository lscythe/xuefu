import type { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { CommandBus } from "../../../src/application/commands/command-bus";
import type { AppError } from "../../../src/application/errors";
import { EventCatalog } from "../../../src/application/events/catalog";
import { EventBus } from "../../../src/application/events/event-bus";
import { TIMER_EVENTS } from "../../../src/application/timesheet/events";
import { TimerQueries } from "../../../src/application/timesheet/queries";
import {
  registerWorkCommands,
  type WorkCommands,
  workCommands,
} from "../../../src/application/work/commands";
import { WORK_EVENTS } from "../../../src/application/work/events";
import { WorkQueries } from "../../../src/application/work/queries";
import type { Result } from "../../../src/domain/shared/result";
import { SqliteEventLedger } from "../../../src/infrastructure/persistence/sqlite/event-ledger";
import { SqliteTimerRepository } from "../../../src/infrastructure/persistence/sqlite/timer-repository";
import { SqliteUnitOfWork } from "../../../src/infrastructure/persistence/sqlite/unit-of-work";
import { SqliteWorkContextRepository } from "../../../src/infrastructure/persistence/sqlite/work-context-repository";
import { SqliteWorkspaceRepository } from "../../../src/infrastructure/persistence/sqlite/workspace-repository";
import { migratedMemoryDatabase } from "../../support/database";
import { ManualClock } from "../../support/manual-clock";
import { SequentialIds } from "../../support/sequential-ids";
import { testLogger } from "../../support/test-logger";

const MINUTE = 60_000;

let db: Database;
let bus: CommandBus;
let commands: WorkCommands;
let work: WorkQueries;
let timers: TimerQueries;
let clock: ManualClock;
let ledger: SqliteEventLedger;

beforeEach(() => {
  db = migratedMemoryDatabase();
  for (const [id, name] of [
    ["mobile-banking", "Mobile Banking"],
    ["auth-service", "Auth Service"],
  ] as const) {
    db.run(
      `INSERT INTO workspaces (id, name, path, group_name, position, added_at)
       VALUES (?, ?, ?, NULL, (SELECT count(*) FROM workspaces), 0)`,
      [id, name, `/work/${id}`],
    );
  }
  const { logger } = testLogger();
  clock = new ManualClock();
  const ids = new SequentialIds();
  ledger = new SqliteEventLedger(db);
  const timerRepository = new SqliteTimerRepository(db);
  const workspaces = new SqliteWorkspaceRepository(db);
  const contexts = new SqliteWorkContextRepository(db);
  bus = new CommandBus({ logger, clock, ids });
  commands = workCommands({
    contexts,
    timers: timerRepository,
    workspaces,
    unitOfWork: new SqliteUnitOfWork(db, ledger, new EventBus(logger)),
    ids,
  });
  const registered = registerWorkCommands(bus, commands);
  if (!registered.ok) throw new Error(registered.error.message);
  work = new WorkQueries(contexts, workspaces);
  timers = new TimerQueries(timerRepository, workspaces);
});
afterEach(() => db.close());

function unwrap<T>(result: Result<T, AppError>): T {
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

function ledgerTypes(): string[] {
  const page = ledger.list({ limit: 100 });
  return page.ok ? page.value.events.map((e) => e.type) : [];
}

const start = (workspace: string, issue: string, title?: string) =>
  bus.invoke(commands.start, { workspace, issue, ...(title === undefined ? {} : { title }) });
const finish = (workspace: string) => bus.invoke(commands.finish, { workspace });
const inProgress = () => unwrap(work.inProgress());
const activeTimer = () => unwrap(timers.active());

describe("work.start", () => {
  test("opens work on the issue and starts its timer", async () => {
    const started = unwrap(await start("mobile-banking", "mob-2841", "Add biometric login"));
    expect(started).toMatchObject({
      work: {
        work: {
          id: "wrk-1",
          workspaceId: "mobile-banking",
          issueKey: "MOB-2841",
          title: "Add biometric login",
          endedAt: null,
        },
        workspace: { name: "Mobile Banking" },
      },
      finished: null,
      timer: { timer: { timer: { issueKey: "MOB-2841", status: "running" } }, replaced: null },
    });
    expect(inProgress()).toEqual([started.work]);
    expect(ledgerTypes()).toEqual(["WorkStarted", "TimerStarted"]);
  });

  test("another issue in the same workspace finishes the old work first", async () => {
    await start("mobile-banking", "MOB-1");
    clock.advance(10 * MINUTE);
    const started = unwrap(await start("mobile-banking", "MOB-2"));
    expect(started.finished).toMatchObject({ issueKey: "MOB-1", endedAt: clock.now() });
    expect(started.timer?.replaced?.timer).toMatchObject({ issueKey: "MOB-1", status: "stopped" });
    expect(inProgress().map((v) => String(v.work.issueKey))).toEqual(["MOB-2"]);
    expect(ledgerTypes()).toEqual([
      "WorkStarted",
      "TimerStarted",
      "WorkStopped",
      "WorkStarted",
      "TimerStopped",
      "TimerStarted",
    ]);
  });

  test("work in another workspace stays open while the timer moves", async () => {
    await start("mobile-banking", "MOB-1");
    clock.advance(MINUTE);
    await start("auth-service", "AUTH-9");
    expect(inProgress().map((v) => String(v.work.issueKey))).toEqual(["MOB-1", "AUTH-9"]);
    expect(activeTimer()?.timer).toMatchObject({ workspaceId: "auth-service", issueKey: "AUTH-9" });
  });

  test("the same issue again resumes its timer and can retitle it", async () => {
    await start("mobile-banking", "MOB-1");
    await start("auth-service", "AUTH-9");
    const again = unwrap(await start("mobile-banking", "MOB-1", "Better title"));
    expect(again.finished).toBeNull();
    expect(again.work.work).toMatchObject({ id: "wrk-1", title: "Better title" });
    expect(again.timer?.timer.timer).toMatchObject({ issueKey: "MOB-1", status: "running" });
    expect(ledgerTypes().filter((t) => t.startsWith("Work"))).toEqual([
      "WorkStarted",
      "WorkStarted",
    ]);
  });

  test("a new title while the timer runs is saved without touching the timer", async () => {
    await start("mobile-banking", "MOB-1");
    const retitled = unwrap(await start("mobile-banking", "MOB-1", "Named"));
    expect(retitled.timer).toBeNull();
    expect(inProgress()[0]?.work.title).toBe(retitled.work.work.title);
  });

  test("starting what is already running is a conflict", async () => {
    await start("mobile-banking", "MOB-1");
    expect(await start("mobile-banking", "MOB-1")).toMatchObject({
      ok: false,
      error: { kind: "conflict", message: "Already working on MOB-1 in Mobile Banking" },
    });
    expect(ledgerTypes()).toEqual(["WorkStarted", "TimerStarted"]);
  });

  test("unknown workspaces and malformed input are refused", async () => {
    expect(await start("ghost", "MOB-1")).toMatchObject({
      ok: false,
      error: { kind: "not-found", entity: "workspace" },
    });
    expect(await start("mobile-banking", "nope")).toMatchObject({
      ok: false,
      error: { kind: "validation" },
    });
    expect(await start("mobile-banking", "MOB-1", "")).toMatchObject({
      ok: false,
      error: { kind: "validation" },
    });
  });
});

describe("work.finish", () => {
  test("ends the work and stops its timer", async () => {
    await start("mobile-banking", "MOB-1");
    clock.advance(25 * MINUTE);
    const finished = unwrap(await finish("mobile-banking"));
    expect(finished.work.work).toMatchObject({ issueKey: "MOB-1", endedAt: clock.now() });
    expect(finished.timer?.timer).toMatchObject({ status: "stopped" });
    expect(inProgress()).toEqual([]);
    expect(activeTimer()).toBeNull();
    expect(ledgerTypes().slice(-2)).toEqual(["WorkStopped", "TimerStopped"]);
  });

  test("leaves a timer that belongs to other work alone", async () => {
    await start("mobile-banking", "MOB-1");
    await start("auth-service", "AUTH-9");
    const finished = unwrap(await finish("mobile-banking"));
    expect(finished.timer).toBeNull();
    expect(activeTimer()?.timer.issueKey).toBe(unwrap(work.inProgress())[0]?.work.issueKey ?? null);
  });

  test("with nothing in progress it says so", async () => {
    expect(await finish("mobile-banking")).toMatchObject({
      ok: false,
      error: {
        kind: "not-found",
        entity: "work",
        message: "No work in progress in Mobile Banking",
      },
    });
    expect(await finish("ghost")).toMatchObject({
      ok: false,
      error: { kind: "not-found", entity: "workspace" },
    });
  });

  test("work outlives a removed workspace and can still be finished", async () => {
    await start("mobile-banking", "MOB-1");
    db.run("DELETE FROM workspaces WHERE id = 'mobile-banking'");
    expect(inProgress()).toMatchObject([{ work: { issueKey: "MOB-1" }, workspace: null }]);
    expect(unwrap(await finish("mobile-banking")).work.workspace).toBeNull();
  });
});

test("storage failures surface as errors and leave nothing half done", async () => {
  await start("mobile-banking", "MOB-1");
  db.run("DROP TABLE timer_segments");
  expect(await start("mobile-banking", "MOB-2")).toMatchObject({
    ok: false,
    error: { kind: "storage" },
  });
  expect(await finish("mobile-banking")).toMatchObject({ ok: false, error: { kind: "storage" } });
  expect(ledgerTypes()).toEqual(["WorkStarted", "TimerStarted"]);
  db.run("DROP TABLE work_contexts");
  expect(await start("auth-service", "AUTH-1")).toMatchObject({ ok: false });
  expect(await finish("auth-service")).toMatchObject({ ok: false });
  expect(work.inProgress()).toMatchObject({ ok: false, error: { kind: "storage" } });
  db.run("DROP TABLE workspaces");
  expect(await start("auth-service", "AUTH-1")).toMatchObject({ ok: false });
  expect(await finish("auth-service")).toMatchObject({ ok: false });
});

test("every recorded event decodes against the catalogs", async () => {
  await start("mobile-banking", "MOB-1", "Title");
  await start("mobile-banking", "MOB-2");
  await finish("mobile-banking");
  const catalog = EventCatalog.create([...WORK_EVENTS, ...TIMER_EVENTS]);
  if (!catalog.ok) throw new Error(catalog.error.message);
  const page = ledger.list({ limit: 100 });
  if (!page.ok) throw new Error(page.error.message);
  for (const event of page.value.events) expect(catalog.value.decode(event).ok).toBe(true);
});
