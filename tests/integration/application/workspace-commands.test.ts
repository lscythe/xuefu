import type { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { confirmationTokenFor } from "../../../src/application/commands/command";
import { CommandBus } from "../../../src/application/commands/command-bus";
import type { AppError } from "../../../src/application/errors";
import { EventCatalog } from "../../../src/application/events/catalog";
import { EventBus } from "../../../src/application/events/event-bus";
import type {
  ProbedDirectory,
  WorkspaceProbe,
} from "../../../src/application/ports/workspace-probe";
import {
  registerWorkspaceCommands,
  workspaceCommands,
} from "../../../src/application/workspace/commands";
import { WORKSPACE_EVENTS } from "../../../src/application/workspace/events";
import { WorkspaceQueries } from "../../../src/application/workspace/queries";
import { type FileSystemError, fileSystemError } from "../../../src/domain/shared/errors";
import type { DomainEvent } from "../../../src/domain/shared/event";
import type { AbsolutePath } from "../../../src/domain/shared/path";
import { err, ok, type Result } from "../../../src/domain/shared/result";
import { SqliteEventLedger } from "../../../src/infrastructure/persistence/sqlite/event-ledger";
import { SqliteUnitOfWork } from "../../../src/infrastructure/persistence/sqlite/unit-of-work";
import { SqliteWorkspaceRepository } from "../../../src/infrastructure/persistence/sqlite/workspace-repository";
import { migratedMemoryDatabase } from "../../support/database";
import { ManualClock } from "../../support/manual-clock";
import { SequentialIds } from "../../support/sequential-ids";
import { testLogger } from "../../support/test-logger";

/** Directories that "exist", keyed by the path a caller passes; values are canonical paths. */
class FakeProbe implements WorkspaceProbe {
  readonly directories = new Map<string, ProbedDirectory>();

  dir(path: string, options: { canonical?: string; git?: boolean; gradle?: boolean } = {}): this {
    this.directories.set(path, {
      path: (options.canonical ?? path) as AbsolutePath,
      capabilities: { git: options.git ?? false, gradle: options.gradle ?? false },
    });
    return this;
  }

  probe(path: AbsolutePath): Promise<Result<ProbedDirectory, FileSystemError>> {
    const found = this.directories.get(path);
    return Promise.resolve(
      found === undefined
        ? err(fileSystemError("Directory does not exist", path, "stat"))
        : ok(found),
    );
  }
}

let db: Database;
let bus: CommandBus;
let probe: FakeProbe;
let queries: WorkspaceQueries;
let published: DomainEvent[];
let ledger: SqliteEventLedger;
let clock: ManualClock;

beforeEach(() => {
  db = migratedMemoryDatabase();
  const { logger } = testLogger();
  clock = new ManualClock();
  const ids = new SequentialIds();
  const events = new EventBus(logger);
  published = [];
  events.subscribe("*", (e) => void published.push(e));
  ledger = new SqliteEventLedger(db);
  const repository = new SqliteWorkspaceRepository(db);
  probe = new FakeProbe();
  bus = new CommandBus({ logger, clock, ids });
  const commands = workspaceCommands({
    repository,
    probe,
    unitOfWork: new SqliteUnitOfWork(db, ledger, events),
    ids,
  });
  const registered = registerWorkspaceCommands(bus, commands);
  if (!registered.ok) throw new Error(registered.error.message);
  queries = new WorkspaceQueries(repository, probe);
});
afterEach(() => db.close());

function expectError(result: Result<unknown, AppError>, kind: AppError["kind"]): AppError {
  if (result.ok) throw new Error(`expected a ${kind} error`);
  expect(result.error.kind).toBe(kind);
  return result.error;
}

async function listIds(): Promise<string[]> {
  const listed = await queries.list();
  if (!listed.ok) throw new Error(listed.error.message);
  return listed.value.map((v) => v.workspace.id);
}

function ledgerTypes(): string[] {
  const page = ledger.list({ limit: 100 });
  return page.ok ? page.value.events.map((e) => e.type) : [];
}

describe("workspace.add", () => {
  test("registers the canonical path, records an event and publishes it after commit", async () => {
    probe.dir("/work/link", { canonical: "/work/mobile-banking", git: true });
    const result = await bus.dispatch("workspace.add", { path: "/work/link" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toMatchObject({
      workspace: { id: "mobile-banking", name: "mobile-banking", path: "/work/mobile-banking" },
      capabilities: { git: true, gradle: false },
    });
    expect(ledgerTypes()).toEqual(["WorkspaceAdded"]);
    expect(published).toHaveLength(1);
    expect(published[0]).toMatchObject({
      type: "WorkspaceAdded",
      version: 1,
      workspaceId: "mobile-banking",
      payload: { id: "mobile-banking", name: "mobile-banking", path: "/work/mobile-banking" },
    });
  });

  test("uses the given name, id and group", async () => {
    probe.dir("/work/m");
    const result = await bus.dispatch("workspace.add", {
      path: "/work/m",
      name: " Mobile Banking ",
      id: "mob",
      group: "Client A",
    });
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value).toMatchObject({
      workspace: { id: "mob", name: "Mobile Banking", group: "Client A" },
    });
  });

  test("a missing directory is a filesystem error and records nothing", async () => {
    expectError(await bus.dispatch("workspace.add", { path: "/nowhere" }), "filesystem");
    expect(ledgerTypes()).toEqual([]);
    expect(await listIds()).toEqual([]);
  });

  test("a path that is already registered is a conflict and records nothing", async () => {
    probe.dir("/work/a").dir("/work/link-to-a", { canonical: "/work/a" });
    await bus.dispatch("workspace.add", { path: "/work/a" });
    expectError(await bus.dispatch("workspace.add", { path: "/work/link-to-a" }), "conflict");
    expect(ledgerTypes()).toEqual(["WorkspaceAdded"]);
  });

  test.each([
    [{ path: "relative" }, "path"],
    [{ path: "/work/a", name: "\t" }, "name"],
    [{ path: "/work/a", id: "Not Valid" }, "id"],
    [{ path: "/work/a", group: "" }, "group"],
  ])("rejects invalid input %p", async (input, field) => {
    probe.dir("/work/a");
    const error = expectError(await bus.dispatch("workspace.add", input), "validation");
    if (error.kind === "validation") expect(error.issues[0]?.path).toBe(field);
  });

  test("rejects unknown fields", async () => {
    expectError(await bus.dispatch("workspace.add", { path: "/a", colour: "red" }), "validation");
  });
});

describe("workspace.remove", () => {
  beforeEach(async () => {
    probe.dir("/work/a").dir("/work/b");
    await bus.dispatch("workspace.add", { path: "/work/a" });
    await bus.dispatch("workspace.add", { path: "/work/b" });
  });

  test("requires confirmation that names the workspace and its folder", async () => {
    const error = expectError(
      await bus.dispatch("workspace.remove", { id: "a" }),
      "confirmation-required",
    );
    if (error.kind !== "confirmation-required") return;
    expect(error.prompt.severity).toBe("confirm");
    expect(error.prompt.details).toContainEqual({ label: "Folder", value: "/work/a" });
    expect(error.prompt.consequence).toContain("not deleted");
    expect(await listIds()).toEqual(["a", "b"]);
  });

  test("removes once confirmed and records the removal", async () => {
    const first = await bus.dispatch("workspace.remove", { id: "a" });
    if (first.ok || first.error.kind !== "confirmation-required") throw new Error("no prompt");
    const confirmed = await bus.dispatch(
      "workspace.remove",
      { id: "a" },
      { confirmation: confirmationTokenFor(first.error) },
    );
    expect(confirmed.ok).toBe(true);
    expect(await listIds()).toEqual(["b"]);
    expect(ledgerTypes()).toEqual(["WorkspaceAdded", "WorkspaceAdded", "WorkspaceRemoved"]);
  });

  test("an unknown id is reported as not found, even when confirmed", async () => {
    const first = await bus.dispatch("workspace.remove", { id: "ghost" });
    if (first.ok || first.error.kind !== "confirmation-required") throw new Error("no prompt");
    expect(first.error.prompt.details).toContainEqual({ label: "Workspace", value: "ghost" });
    const confirmed = await bus.dispatch(
      "workspace.remove",
      { id: "ghost" },
      { confirmation: confirmationTokenFor(first.error) },
    );
    expectError(confirmed, "not-found");
  });

  test("an invalid id is a validation error", async () => {
    expectError(await bus.dispatch("workspace.remove", { id: "../x" }), "validation");
  });
});

describe("workspace.group.assign", () => {
  beforeEach(async () => {
    probe.dir("/work/a");
    await bus.dispatch("workspace.add", { path: "/work/a" });
  });

  test("sets and clears the group", async () => {
    const set = await bus.dispatch("workspace.group.assign", { id: "a", group: "Client" });
    expect(set).toMatchObject({ ok: true, value: { id: "a", group: "Client" } });
    const cleared = await bus.dispatch("workspace.group.assign", { id: "a", group: null });
    expect(cleared).toMatchObject({ ok: true, value: { id: "a", group: null } });
    expect(ledgerTypes()).toEqual([
      "WorkspaceAdded",
      "WorkspaceGroupAssigned",
      "WorkspaceGroupAssigned",
    ]);
  });

  test("an unknown workspace is not found", async () => {
    expectError(
      await bus.dispatch("workspace.group.assign", { id: "ghost", group: "x" }),
      "not-found",
    );
  });

  test("an invalid group is a validation error", async () => {
    expectError(
      await bus.dispatch("workspace.group.assign", { id: "a", group: " " }),
      "validation",
    );
  });
});

describe("workspace.activate", () => {
  beforeEach(async () => {
    probe.dir("/work/a").dir("/work/b");
    await bus.dispatch("workspace.add", { path: "/work/a" });
    await bus.dispatch("workspace.add", { path: "/work/b" });
  });

  test("nothing is last active before the first activation", () => {
    expect(queries.lastActive()).toEqual({ ok: true, value: null });
  });

  test("stamps the time, records the activation and becomes the last active workspace", async () => {
    clock.advance(1_000);
    const activated = await bus.dispatch("workspace.activate", { id: "b" });
    expect(activated).toMatchObject({ ok: true, value: { id: "b", lastActiveAt: clock.now() } });
    expect(ledgerTypes()).toEqual(["WorkspaceAdded", "WorkspaceAdded", "WorkspaceActivated"]);
    const last = queries.lastActive();
    expect(last.ok ? (last.value?.id as string | undefined) : null).toBe("b");

    clock.advance(1_000);
    await bus.dispatch("workspace.activate", { id: "a" });
    const later = queries.lastActive();
    expect(later.ok ? (later.value?.id as string | undefined) : null).toBe("a");
  });

  test("an unknown workspace is not found and records nothing", async () => {
    expectError(await bus.dispatch("workspace.activate", { id: "ghost" }), "not-found");
    expect(ledgerTypes()).toEqual(["WorkspaceAdded", "WorkspaceAdded"]);
  });
});

describe("WorkspaceQueries", () => {
  test("list reports capabilities and folders that have gone missing", async () => {
    probe.dir("/work/a", { git: true, gradle: true }).dir("/work/b");
    await bus.dispatch("workspace.add", { path: "/work/a" });
    await bus.dispatch("workspace.add", { path: "/work/b" });
    probe.directories.delete("/work/b");
    const listed = await queries.list();
    if (!listed.ok) throw new Error(listed.error.message);
    expect(listed.value.map((v) => [v.workspace.id as string, v.status, v.capabilities])).toEqual([
      ["a", "ready", { git: true, gradle: true }],
      ["b", "missing", { git: false, gradle: false }],
    ]);
  });

  test("which resolves the canonical path and returns the deepest workspace", async () => {
    probe.dir("/work/mono").dir("/work/mono/apps/android");
    await bus.dispatch("workspace.add", { path: "/work/mono" });
    await bus.dispatch("workspace.add", { path: "/work/mono/apps/android" });
    probe.dir("/home/me/android-src", { canonical: "/work/mono/apps/android/app/src" });
    probe.dir("/elsewhere");

    const inside = await queries.which("/home/me/android-src" as AbsolutePath);
    expect(inside.ok ? (inside.value?.id as string | undefined) : null).toBe("android");
    const outside = await queries.which("/elsewhere" as AbsolutePath);
    expect(outside).toEqual({ ok: true, value: null });
  });

  test("which reports a missing directory", async () => {
    expectError(await queries.which("/nowhere" as AbsolutePath), "filesystem");
  });
});

describe("registerWorkspaceCommands", () => {
  test("refuses to register the commands twice", () => {
    const again = registerWorkspaceCommands(
      bus,
      workspaceCommands({
        repository: new SqliteWorkspaceRepository(db),
        probe,
        unitOfWork: new SqliteUnitOfWork(db, ledger, new EventBus(testLogger().logger)),
        ids: new SequentialIds(),
      }),
    );
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.error.kind).toBe("duplicate-command");
  });
});

describe("workspace events", () => {
  test("every recorded workspace event decodes with the catalog", async () => {
    probe.dir("/work/a");
    await bus.dispatch("workspace.add", { path: "/work/a", group: "G" });
    await bus.dispatch("workspace.group.assign", { id: "a", group: null });
    await bus.dispatch("workspace.activate", { id: "a" });
    const prompt = await bus.dispatch("workspace.remove", { id: "a" });
    if (prompt.ok || prompt.error.kind !== "confirmation-required") throw new Error("no prompt");
    await bus.dispatch(
      "workspace.remove",
      { id: "a" },
      {
        confirmation: confirmationTokenFor(prompt.error),
      },
    );

    const catalog = EventCatalog.create(WORKSPACE_EVENTS);
    if (!catalog.ok) throw new Error(catalog.error.message);
    const page = ledger.list({ limit: 100 });
    if (!page.ok) throw new Error(page.error.message);
    expect(page.value.events).toHaveLength(4);
    for (const event of page.value.events) expect(catalog.value.decode(event).ok).toBe(true);
  });
});
