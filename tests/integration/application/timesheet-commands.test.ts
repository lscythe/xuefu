import type { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { confirmationTokenFor } from "../../../src/application/commands/command";
import { CommandBus } from "../../../src/application/commands/command-bus";
import type { AppError } from "../../../src/application/errors";
import { EventCatalog } from "../../../src/application/events/catalog";
import { EventBus } from "../../../src/application/events/event-bus";
import { TIMER_EVENTS } from "../../../src/application/timesheet/events";
import { TimerQueries } from "../../../src/application/timesheet/queries";
import {
  registerTimesheetCommands,
  type TimesheetCommands,
  timesheetCommands,
} from "../../../src/application/timesheet/timesheet-commands";
import type { CalendarDay } from "../../../src/domain/shared/calendar";
import type { EntryId, TimerId, WorkspaceId } from "../../../src/domain/shared/ids";
import type { Result } from "../../../src/domain/shared/result";
import type { Timestamp } from "../../../src/domain/shared/time";
import { pauseTimer, startTimer, stopTimer } from "../../../src/domain/timesheet/timer";
import { SqliteEventLedger } from "../../../src/infrastructure/persistence/sqlite/event-ledger";
import { SqliteTimerRepository } from "../../../src/infrastructure/persistence/sqlite/timer-repository";
import { SqliteTimesheetRepository } from "../../../src/infrastructure/persistence/sqlite/timesheet-repository";
import { SqliteUnitOfWork } from "../../../src/infrastructure/persistence/sqlite/unit-of-work";
import { SqliteWorkspaceRepository } from "../../../src/infrastructure/persistence/sqlite/workspace-repository";
import { migratedMemoryDatabase } from "../../support/database";
import { ManualClock } from "../../support/manual-clock";
import { SequentialIds } from "../../support/sequential-ids";
import { testLogger } from "../../support/test-logger";

const MINUTE = 60_000;
const NOW = Date.UTC(2026, 8, 7, 9, 0);
const at = (minutes: number) => (NOW + minutes * MINUTE) as Timestamp;

let db: Database;
let bus: CommandBus;
let commands: TimesheetCommands;
let queries: TimerQueries;
let timers: SqliteTimerRepository;
let ledger: SqliteEventLedger;
let clock: ManualClock;

beforeEach(() => {
  db = migratedMemoryDatabase();
  db.run(
    `INSERT INTO workspaces (id, name, path, group_name, position, added_at)
     VALUES ('mobile-banking', 'Mobile Banking', '/work/mobile-banking', NULL, 0, 0)`,
  );
  const { logger } = testLogger();
  clock = new ManualClock(NOW);
  const ids = new SequentialIds();
  ledger = new SqliteEventLedger(db);
  const timesheet = new SqliteTimesheetRepository(db);
  const workspaces = new SqliteWorkspaceRepository(db);
  timers = new SqliteTimerRepository(db);
  bus = new CommandBus({ logger, clock, ids });
  commands = timesheetCommands({
    timesheet,
    timers,
    workspaces,
    unitOfWork: new SqliteUnitOfWork(db, ledger, new EventBus(logger)),
    ids,
  });
  const registered = registerTimesheetCommands(bus, commands);
  if (!registered.ok) throw new Error(registered.error.message);
  queries = new TimerQueries(timers, timesheet, workspaces);
});
afterEach(() => db.close());

function unwrap<T>(result: Result<T, AppError | unknown>): T {
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.value;
}

function ledgerEvents() {
  const page = ledger.list({ limit: 100 });
  return page.ok ? page.value.events.map((e) => ({ type: e.type, payload: e.payload })) : [];
}

const meeting = (extra: object = {}) =>
  bus.invoke(commands.add, {
    workspace: "mobile-banking",
    category: "Meeting",
    start: at(-60),
    end: at(-30),
    note: " Sprint planning ",
    ...extra,
  });

const spans = () => unwrap(queries.tracked(at(-24 * 60), at(24 * 60))).spans;

describe("time entries", () => {
  test("time added shows with timed time, and is recorded without its note", async () => {
    expect(await meeting()).toMatchObject({
      ok: true,
      value: { id: "ent-1", category: "Meeting", note: "Sprint planning" },
    });
    expect(
      await bus.invoke(commands.add, {
        workspace: "mobile-banking",
        issue: "MOB-1",
        start: at(-120),
        end: at(-90),
      }),
    ).toMatchObject({ ok: true, value: { issueKey: "MOB-1", category: null, note: null } });
    expect(queries.entry("ent-1" as EntryId)).toMatchObject({
      ok: true,
      value: { id: "ent-1", category: "Meeting" },
    });
    expect(queries.entry("ent-9" as EntryId)).toEqual({ ok: true, value: null });
    expect<unknown>(spans().map((s) => [s.issueKey ?? s.category, s.note])).toEqual([
      ["MOB-1", null],
      ["Meeting", "Sprint planning"],
    ]);
    expect(ledgerEvents()).toEqual([
      {
        type: "TimeEntryAdded",
        payload: { entryId: "ent-1", issueKey: null, category: "Meeting", durationMs: 30 * MINUTE },
      },
      {
        type: "TimeEntryAdded",
        payload: { entryId: "ent-2", issueKey: "MOB-1", category: null, durationMs: 30 * MINUTE },
      },
    ]);
    const catalog = EventCatalog.create(TIMER_EVENTS);
    if (!catalog.ok) throw new Error(catalog.error.message);
    const page = unwrap(ledger.list({ limit: 10 }));
    for (const event of page.events) expect(catalog.value.decode(event).ok).toBe(true);
  });

  test("added time needs a known workspace, and an issue or a category", async () => {
    expect(await meeting({ workspace: "ghost" })).toMatchObject({
      ok: false,
      error: { kind: "not-found" },
    });
    expect(await meeting({ category: undefined })).toMatchObject({
      ok: false,
      error: { kind: "validation" },
    });
    expect(await meeting({ end: at(-90) })).toMatchObject({
      ok: false,
      error: { kind: "validation", issues: [{ path: "to" }] },
    });
    expect(ledgerEvents()).toEqual([]);
  });

  test("editing changes what is given; an issue takes the place of a category", async () => {
    await meeting();
    expect(
      await bus.invoke(commands.edit, { id: "ent-1", issue: "MOB-7", end: at(-15), note: "" }),
    ).toMatchObject({
      ok: true,
      value: { issueKey: "MOB-7", category: null, start: at(-60), end: at(-15), note: null },
    });
    expect(await bus.invoke(commands.edit, { id: "ent-1", category: "Review" })).toMatchObject({
      ok: true,
      value: { issueKey: null, category: "Review", end: at(-15) },
    });
    expect(await bus.invoke(commands.edit, { id: "ent-9", note: "x" })).toMatchObject({
      ok: false,
      error: { kind: "not-found", message: "No time entry ent-9" },
    });
    expect(await bus.invoke(commands.edit, { id: "ent-1", start: at(0) })).toMatchObject({
      ok: false,
      error: { kind: "validation" },
    });
    expect(ledgerEvents().at(-1)).toEqual({
      type: "TimeEntryChanged",
      payload: { entryId: "ent-1", durationMs: 45 * MINUTE },
    });
  });

  test("deleting asks first, says what goes, then takes it off", async () => {
    await meeting();
    const asked = await bus.invoke(commands.remove, { id: "ent-1" });
    expect(asked).toMatchObject({
      ok: false,
      error: {
        kind: "confirmation-required",
        prompt: {
          details: [
            { label: "Entry", value: "ent-1" },
            { label: "On", value: "Meeting" },
            { label: "Minutes", value: "30" },
          ],
        },
      },
    });
    if (asked.ok || asked.error.kind !== "confirmation-required") throw new Error("expected ask");
    const removed = await bus.invoke(
      commands.remove,
      { id: "ent-1" },
      { confirmation: confirmationTokenFor(asked.error) },
    );
    expect(removed).toMatchObject({ ok: true, value: { id: "ent-1" } });
    expect(spans()).toEqual([]);
    expect(ledgerEvents().at(-1)).toEqual({
      type: "TimeEntryDeleted",
      payload: { entryId: "ent-1", durationMs: 30 * MINUTE },
    });
    const again = await bus.invoke(commands.remove, { id: "ent-1" });
    if (again.ok || again.error.kind !== "confirmation-required") throw new Error("expected ask");
    expect(again.error.prompt.details).toEqual([{ label: "Entry", value: "ent-1" }]);
    expect(
      await bus.invoke(
        commands.remove,
        { id: "ent-1" },
        { confirmation: confirmationTokenFor(again.error) },
      ),
    ).toMatchObject({ ok: false, error: { kind: "not-found" } });
  });
});

describe("timed time", () => {
  const leftRunning = () => {
    const started = startTimer(
      { id: "t1" as TimerId, workspaceId: "mobile-banking" as WorkspaceId, issueKey: null },
      at(-600),
    );
    const paused = unwrap(pauseTimer(started, at(-300)));
    unwrap(timers.save(unwrap(stopTimer(paused, at(-300)))));
  };

  test("a timer's stretch is moved to when it really ended", async () => {
    leftRunning();
    expect(
      await bus.invoke(commands.moveTimer, {
        timer: "t1",
        position: 0,
        start: at(-600),
        end: at(-480),
      }),
    ).toMatchObject({ ok: true, value: { segments: [{ start: at(-600), end: at(-480) }] } });
    expect<unknown>(spans().map((s) => [s.source, s.end])).toEqual([
      [{ kind: "timer", id: "t1", position: 0 }, at(-480)],
    ]);
    expect(ledgerEvents()).toEqual([
      { type: "TimerSegmentMoved", payload: { timerId: "t1", position: 0 } },
    ]);
  });

  test("regression: a first stretch moved earlier moves the stored timer's start, so it reads back", async () => {
    leftRunning();
    await bus.invoke(commands.moveTimer, {
      timer: "t1",
      position: 0,
      start: at(-700),
      end: at(-650),
    });
    expect(timers.timer("t1" as TimerId)).toMatchObject({
      ok: true,
      value: { startedAt: at(-700), segments: [{ start: at(-700), end: at(-650) }] },
    });
    // And it can be moved again.
    expect(
      await bus.invoke(commands.moveTimer, {
        timer: "t1",
        position: 0,
        start: at(-700),
        end: at(-640),
      }),
    ).toMatchObject({ ok: true });
  });

  test("a timer's stretch is found by its timer and place, else null", () => {
    leftRunning();
    expect(queries.stretch("t1" as TimerId, 0)).toEqual({
      ok: true,
      value: { start: at(-600), end: at(-300) },
    });
    expect(queries.stretch("t1" as TimerId, 1)).toEqual({ ok: true, value: null });
    expect(queries.stretch("t9" as TimerId, 0)).toEqual({ ok: true, value: null });
  });

  test("an unknown timer, or a move it refuses, changes nothing", async () => {
    leftRunning();
    expect(
      await bus.invoke(commands.moveTimer, { timer: "t9", position: 0, start: at(0), end: null }),
    ).toMatchObject({ ok: false, error: { kind: "not-found" } });
    expect(
      await bus.invoke(commands.moveTimer, {
        timer: "t1",
        position: 0,
        start: at(-600),
        end: at(60),
      }),
    ).toMatchObject({ ok: false, error: { kind: "validation" } });
    expect(ledgerEvents()).toEqual([]);
  });
});

describe("days", () => {
  const day = "2026-09-07" as CalendarDay;
  const days = () => unwrap(queries.days(day, day));

  test("a day's place, leave and tasks are kept apart, and blank puts each back", async () => {
    expect(
      await bus.invoke(commands.setDay, { day, place: "Head office", tasks: "Login: fixed." }),
    ).toMatchObject({
      ok: true,
      value: { day, place: "Head office", leave: false, tasks: "Login: fixed." },
    });
    await bus.invoke(commands.setDay, { day, leave: true });
    expect<unknown>(days()).toEqual([
      { day, place: "Head office", leave: true, tasks: "Login: fixed." },
    ]);
    await bus.invoke(commands.setDay, { day, place: "  ", tasks: "", leave: false });
    expect(days()).toEqual([]);
    expect(ledgerEvents().map((e) => e.payload)).toEqual([
      { day, leave: false, tasks: true },
      { day, leave: true, tasks: true },
      { day, leave: false, tasks: false },
    ]);
  });

  test("a day that is not a date, or a place on two lines, is refused", async () => {
    expect(await bus.invoke(commands.setDay, { day: "2026-09-31", leave: true })).toMatchObject({
      ok: false,
      error: { kind: "validation" },
    });
    expect(await bus.invoke(commands.setDay, { day, place: "a\nb" })).toMatchObject({
      ok: false,
      error: { kind: "validation" },
    });
  });
});
