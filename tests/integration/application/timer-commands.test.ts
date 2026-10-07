import type { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { CommandBus } from "../../../src/application/commands/command-bus";
import type { AppError } from "../../../src/application/errors";
import { EventCatalog } from "../../../src/application/events/catalog";
import { EventBus } from "../../../src/application/events/event-bus";
import {
  registerTimerCommands,
  type TimerCommands,
  timerCommands,
} from "../../../src/application/timesheet/commands";
import { TIMER_EVENTS } from "../../../src/application/timesheet/events";
import { TimerQueries } from "../../../src/application/timesheet/queries";
import type { DomainEvent } from "../../../src/domain/shared/event";
import type { Result } from "../../../src/domain/shared/result";
import { elapsed } from "../../../src/domain/timesheet/timer";
import { SqliteEventLedger } from "../../../src/infrastructure/persistence/sqlite/event-ledger";
import { SqliteTimerRepository } from "../../../src/infrastructure/persistence/sqlite/timer-repository";
import { SqliteUnitOfWork } from "../../../src/infrastructure/persistence/sqlite/unit-of-work";
import { SqliteWorkspaceRepository } from "../../../src/infrastructure/persistence/sqlite/workspace-repository";
import { migratedMemoryDatabase } from "../../support/database";
import { ManualClock } from "../../support/manual-clock";
import { SequentialIds } from "../../support/sequential-ids";
import { testLogger } from "../../support/test-logger";

const MINUTE = 60_000;

let db: Database;
let bus: CommandBus;
let commands: TimerCommands;
let queries: TimerQueries;
let clock: ManualClock;
let ledger: SqliteEventLedger;
let published: DomainEvent[];

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
  const events = new EventBus(logger);
  published = [];
  events.subscribe("*", (e) => void published.push(e));
  ledger = new SqliteEventLedger(db);
  const timers = new SqliteTimerRepository(db);
  const workspaces = new SqliteWorkspaceRepository(db);
  bus = new CommandBus({ logger, clock, ids });
  commands = timerCommands({
    timers,
    workspaces,
    unitOfWork: new SqliteUnitOfWork(db, ledger, events),
    ids,
  });
  const registered = registerTimerCommands(bus, commands);
  if (!registered.ok) throw new Error(registered.error.message);
  queries = new TimerQueries(timers, workspaces);
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

const active = () => unwrap(queries.active());

describe("timer.start", () => {
  test("starts a timer for the workspace and issue, recording the event", async () => {
    const started = unwrap(
      await bus.invoke(commands.start, { workspace: "mobile-banking", issue: "mob-2841" }),
    );
    expect(started.replaced).toBeNull();
    expect(started.timer).toMatchObject({
      timer: {
        id: "tmr-1",
        workspaceId: "mobile-banking",
        issueKey: "MOB-2841",
        status: "running",
      },
      workspace: { name: "Mobile Banking" },
    });
    expect(active()).toEqual(started.timer);
    expect(published).toMatchObject([
      {
        type: "TimerStarted",
        workspaceId: "mobile-banking",
        payload: { timerId: "tmr-1", workspaceId: "mobile-banking", issueKey: "MOB-2841" },
      },
    ]);
  });

  test("starting elsewhere stops the active timer first", async () => {
    await bus.invoke(commands.start, { workspace: "mobile-banking" });
    clock.advance(25 * MINUTE);
    const started = unwrap(await bus.invoke(commands.start, { workspace: "auth-service" }));
    expect(started.timer.timer).toMatchObject({ id: "tmr-2", workspaceId: "auth-service" });
    expect(started.replaced?.timer).toMatchObject({ id: "tmr-1", status: "stopped" });
    expect(published.at(-2)).toMatchObject({
      type: "TimerStopped",
      payload: { timerId: "tmr-1", elapsedMs: 25 * MINUTE },
    });
    expect<string | undefined>(active()?.timer.id).toBe("tmr-2");
  });

  test("another issue in the same workspace is a new timer too", async () => {
    await bus.invoke(commands.start, { workspace: "mobile-banking", issue: "MOB-1" });
    const started = unwrap(
      await bus.invoke(commands.start, { workspace: "mobile-banking", issue: "MOB-2" }),
    );
    expect<string | null | undefined>(started.replaced?.timer.issueKey).toBe("MOB-1");
    expect<string | null>(started.timer.timer.issueKey).toBe("MOB-2");
  });

  test("the same paused timer resumes rather than starting over", async () => {
    await bus.invoke(commands.start, { workspace: "mobile-banking" });
    clock.advance(MINUTE);
    await bus.invoke(commands.pause, {});
    clock.advance(MINUTE);
    const resumed = unwrap(await bus.invoke(commands.start, { workspace: "mobile-banking" }));
    expect(resumed).toMatchObject({
      timer: { timer: { id: "tmr-1", status: "running" } },
      replaced: null,
    });
    expect(ledgerTypes()).toEqual(["TimerStarted", "TimerPaused", "TimerResumed"]);
  });

  test("the same running timer is a conflict, so a double press does nothing", async () => {
    await bus.invoke(commands.start, { workspace: "mobile-banking" });
    expect(await bus.invoke(commands.start, { workspace: "mobile-banking" })).toMatchObject({
      ok: false,
      error: { kind: "conflict", message: "A timer is already running for Mobile Banking" },
    });
    expect(ledgerTypes()).toEqual(["TimerStarted"]);
  });

  test("an unknown workspace or a malformed issue is refused", async () => {
    expect(await bus.invoke(commands.start, { workspace: "ghost" })).toMatchObject({
      ok: false,
      error: { kind: "not-found", entity: "workspace" },
    });
    expect(
      await bus.invoke(commands.start, { workspace: "mobile-banking", issue: "nope" }),
    ).toMatchObject({ ok: false, error: { kind: "validation" } });
    expect(active()).toBeNull();
  });
});

describe("timer.pause, timer.resume and timer.stop", () => {
  test("act on the active timer and record each change", async () => {
    await bus.invoke(commands.start, { workspace: "mobile-banking" });
    clock.advance(10 * MINUTE);
    expect(unwrap(await bus.invoke(commands.pause, {})).timer.status).toBe("paused");
    clock.advance(5 * MINUTE);
    expect(unwrap(await bus.invoke(commands.resume, {})).timer.status).toBe("running");
    clock.advance(20 * MINUTE);
    const stopped = unwrap(await bus.invoke(commands.stop, {}));
    expect(stopped.timer.status).toBe("stopped");
    expect<number>(elapsed(stopped.timer, clock.now())).toBe(30 * MINUTE);
    expect(active()).toBeNull();
    expect(ledgerTypes()).toEqual(["TimerStarted", "TimerPaused", "TimerResumed", "TimerStopped"]);
    expect(published.map((e) => e.payload)).toEqual([
      { timerId: "tmr-1", workspaceId: "mobile-banking", issueKey: null },
      { timerId: "tmr-1", elapsedMs: 10 * MINUTE },
      { timerId: "tmr-1" },
      { timerId: "tmr-1", elapsedMs: 30 * MINUTE },
    ]);
  });

  test("with no active timer they report that none is running", async () => {
    for (const command of [commands.pause, commands.resume, commands.stop]) {
      expect(await bus.invoke(command, {})).toMatchObject({
        ok: false,
        error: { kind: "not-found", entity: "timer", message: "No timer is running" },
      });
    }
  });

  test("a transition that does not apply is a conflict and changes nothing", async () => {
    await bus.invoke(commands.start, { workspace: "mobile-banking" });
    expect(await bus.invoke(commands.resume, {})).toMatchObject({
      ok: false,
      error: { kind: "conflict", message: "The timer is running, not paused" },
    });
    expect(ledgerTypes()).toEqual(["TimerStarted"]);
  });

  test("a timer outlives the workspace it tracks", async () => {
    await bus.invoke(commands.start, { workspace: "mobile-banking" });
    db.run("DELETE FROM workspaces WHERE id = 'mobile-banking'");
    expect(active()).toMatchObject({ timer: { status: "running" }, workspace: null });
    expect(unwrap(await bus.invoke(commands.stop, {})).workspace).toBeNull();
  });
});

describe("timer.toggle", () => {
  test("starts, pauses and resumes the timer of the workspace in front", async () => {
    const toggle = () => bus.invoke(commands.toggle, { workspace: "mobile-banking" });
    expect(unwrap(await toggle())?.timer.status).toBe("running");
    expect(unwrap(await toggle())?.timer.status).toBe("paused");
    expect(unwrap(await toggle())?.timer.status).toBe("running");
    expect(ledgerTypes()).toEqual(["TimerStarted", "TimerPaused", "TimerResumed"]);
  });

  test("a timer it starts can be for an issue", async () => {
    const toggled = unwrap(
      await bus.invoke(commands.toggle, { workspace: "mobile-banking", issue: "MOB-5" }),
    );
    expect(toggled?.timer).toMatchObject({ workspaceId: "mobile-banking", issueKey: "MOB-5" });
  });

  test("in another workspace it starts that workspace's timer", async () => {
    await bus.invoke(commands.start, { workspace: "mobile-banking", issue: "MOB-1" });
    const toggled = unwrap(await bus.invoke(commands.toggle, { workspace: "auth-service" }));
    expect(toggled?.timer).toMatchObject({ workspaceId: "auth-service", issueKey: null });
    expect(ledgerTypes()).toEqual(["TimerStarted", "TimerStopped", "TimerStarted"]);
  });

  test("with no workspace in front it only pauses or resumes", async () => {
    expect(await bus.invoke(commands.toggle, { workspace: null })).toEqual({
      ok: true,
      value: null,
    });
    await bus.invoke(commands.start, { workspace: "auth-service" });
    expect(unwrap(await bus.invoke(commands.toggle, { workspace: null }))?.timer.status).toBe(
      "paused",
    );
  });

  test("a workspace that no longer exists cannot start a timer", async () => {
    expect(await bus.invoke(commands.toggle, { workspace: "ghost" })).toMatchObject({
      ok: false,
      error: { kind: "not-found" },
    });
  });
});

test("storage failures surface as errors and leave nothing half done", async () => {
  await bus.invoke(commands.start, { workspace: "mobile-banking" });
  db.run("DROP TABLE timer_segments");
  for (const command of [commands.pause, commands.stop]) {
    expect(await bus.invoke(command, {})).toMatchObject({ ok: false, error: { kind: "storage" } });
  }
  expect(await bus.invoke(commands.start, { workspace: "auth-service" })).toMatchObject({
    ok: false,
    error: { kind: "storage" },
  });
  expect(await bus.invoke(commands.toggle, { workspace: null })).toMatchObject({
    ok: false,
    error: { kind: "storage" },
  });
  expect(ledgerTypes()).toEqual(["TimerStarted"]);
  db.run("DROP TABLE workspaces");
  expect(queries.active()).toMatchObject({ ok: false, error: { kind: "storage" } });
});

test("every recorded event decodes against the catalog", async () => {
  await bus.invoke(commands.start, { workspace: "mobile-banking", issue: "MOB-7" });
  await bus.invoke(commands.pause, {});
  await bus.invoke(commands.resume, {});
  await bus.invoke(commands.stop, {});
  const catalog = EventCatalog.create(TIMER_EVENTS);
  if (!catalog.ok) throw new Error(catalog.error.message);
  const page = ledger.list({ limit: 100 });
  if (!page.ok) throw new Error(page.error.message);
  expect(page.value.events).toHaveLength(4);
  for (const event of page.value.events) expect(catalog.value.decode(event).ok).toBe(true);
});
