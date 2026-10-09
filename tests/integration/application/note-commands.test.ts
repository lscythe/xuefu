import type { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { CommandBus } from "../../../src/application/commands/command-bus";
import { EventCatalog } from "../../../src/application/events/catalog";
import { EventBus } from "../../../src/application/events/event-bus";
import {
  type NoteCommands,
  noteCommands,
  registerNoteCommands,
} from "../../../src/application/notes/commands";
import { NOTE_EVENTS } from "../../../src/application/notes/events";
import { NoteQueries } from "../../../src/application/notes/queries";
import type { WorkspaceId } from "../../../src/domain/shared/ids";
import type { IssueKey } from "../../../src/domain/work/issue-key";
import { SqliteEventLedger } from "../../../src/infrastructure/persistence/sqlite/event-ledger";
import { SqliteNoteRepository } from "../../../src/infrastructure/persistence/sqlite/note-repository";
import { SqliteUnitOfWork } from "../../../src/infrastructure/persistence/sqlite/unit-of-work";
import { SqliteWorkspaceRepository } from "../../../src/infrastructure/persistence/sqlite/workspace-repository";
import { migratedMemoryDatabase } from "../../support/database";
import { ManualClock } from "../../support/manual-clock";
import { SequentialIds } from "../../support/sequential-ids";
import { testLogger } from "../../support/test-logger";

let db: Database;
let bus: CommandBus;
let commands: NoteCommands;
let notes: NoteQueries;
let clock: ManualClock;
let ledger: SqliteEventLedger;

beforeEach(() => {
  db = migratedMemoryDatabase();
  db.run(
    `INSERT INTO workspaces (id, name, path, group_name, position, added_at)
     VALUES ('mobile-banking', 'Mobile Banking', '/work/mobile-banking', NULL, 0, 0)`,
  );
  const { logger } = testLogger();
  clock = new ManualClock();
  const ids = new SequentialIds();
  ledger = new SqliteEventLedger(db);
  const repository = new SqliteNoteRepository(db);
  const workspaces = new SqliteWorkspaceRepository(db);
  bus = new CommandBus({ logger, clock, ids });
  commands = noteCommands({
    notes: repository,
    workspaces,
    unitOfWork: new SqliteUnitOfWork(db, ledger, new EventBus(logger)),
    ids,
  });
  const registered = registerNoteCommands(bus, commands);
  if (!registered.ok) throw new Error(registered.error.message);
  notes = new NoteQueries(repository, workspaces);
});
afterEach(() => db.close());

const mobile = "mobile-banking" as WorkspaceId;

function ledgerEvents() {
  const page = ledger.list({ limit: 100 });
  return page.ok ? page.value.events.map((e) => ({ type: e.type, payload: e.payload })) : [];
}

const save = (body: string, extra: { issue?: string; append?: boolean } = {}) =>
  bus.invoke(commands.save, { workspace: mobile, body, ...extra });
const found = (issue: string | null = null) => {
  const result = notes.find(mobile, issue as IssueKey | null);
  if (!result.ok) throw new Error(result.error.message);
  return result.value.note;
};

describe("notes.save", () => {
  test("writes the workspace's note, and one per issue", async () => {
    expect(await save("Staging needs the VPN\r\n")).toMatchObject({
      ok: true,
      value: {
        note: { id: "not-1", issueKey: null, body: "Staging needs the VPN" },
        changed: true,
        secret: false,
        workspace: { name: "Mobile Banking" },
      },
    });
    await save("Ask QA about the flaky test", { issue: "mob-1" });
    expect<string | undefined>(found()?.body).toBe("Staging needs the VPN");
    expect<string | undefined>(found("MOB-1")?.body).toBe("Ask QA about the flaky test");
    expect(ledgerEvents()).toEqual([
      {
        type: "NoteSaved",
        payload: { noteId: "not-1", workspaceId: mobile, issueKey: null, characters: 21 },
      },
      {
        type: "NoteSaved",
        payload: { noteId: "not-2", workspaceId: mobile, issueKey: "MOB-1", characters: 27 },
      },
    ]);
  });

  test("saving replaces the text; the same text again changes nothing", async () => {
    await save("first");
    clock.advance(60_000);
    const replaced = await save("second");
    expect(replaced).toMatchObject({ ok: true, value: { note: { id: "not-1", body: "second" } } });
    expect(found()?.updatedAt).toBe(clock.now());
    expect(await save("second  \n")).toMatchObject({ ok: true, value: { changed: false } });
    expect(ledgerEvents()).toHaveLength(2);
  });

  test("append adds a line, starting the note if there is none", async () => {
    await save("first", { append: true });
    await save("second", { append: true });
    expect<string | undefined>(found()?.body).toBe("first\nsecond");
    expect(await save("   ", { append: true })).toMatchObject({
      ok: false,
      error: { kind: "validation", message: "Nothing to add to the note" },
    });
  });

  test("blank text clears the note; clearing nothing changes nothing", async () => {
    await save("gone soon", { issue: "MOB-1" });
    expect(await save("", { issue: "MOB-1" })).toMatchObject({
      ok: true,
      value: { note: null, changed: true },
    });
    expect(found("MOB-1")).toBeNull();
    expect(await save("", { issue: "MOB-1" })).toMatchObject({
      ok: true,
      value: { note: null, changed: false },
    });
    expect(ledgerEvents().map((e) => e.type)).toEqual(["NoteSaved", "NoteCleared"]);
  });

  test("text that looks like a secret is saved, and flagged", async () => {
    expect(await save("staging password=hunter2")).toMatchObject({
      ok: true,
      value: { secret: true, changed: true },
    });
  });

  test("bad input and unknown workspaces are refused", async () => {
    expect(await save("x", { issue: "nope" })).toMatchObject({
      ok: false,
      error: { kind: "validation" },
    });
    expect(await save("bell\u0007")).toMatchObject({ ok: false, error: { kind: "validation" } });
    expect(await bus.invoke(commands.save, { workspace: "ghost", body: "x" })).toMatchObject({
      ok: false,
      error: { kind: "not-found", entity: "workspace" },
    });
    expect(ledgerEvents()).toEqual([]);
  });

  test("storage failures surface as errors and record nothing", async () => {
    db.run("DROP TABLE notes");
    expect(await save("x")).toMatchObject({ ok: false, error: { kind: "storage" } });
    expect(notes.find(mobile, null)).toMatchObject({ ok: false, error: { kind: "storage" } });
    expect(notes.list()).toMatchObject({ ok: false });
    db.run("DROP TABLE workspaces");
    expect(await save("x")).toMatchObject({ ok: false, error: { kind: "storage" } });
    expect(notes.find(mobile, null)).toMatchObject({ ok: false, error: { kind: "storage" } });
    expect(ledgerEvents()).toEqual([]);
  });
});

describe("NoteQueries.find", () => {
  test("names the workspace, and refuses one that is not registered", () => {
    expect(notes.find(mobile, null)).toMatchObject({
      ok: true,
      value: { note: null, workspace: { name: "Mobile Banking" } },
    });
    expect(notes.find("ghost" as WorkspaceId, null)).toMatchObject({
      ok: false,
      error: { kind: "not-found", entity: "workspace" },
    });
  });
});

describe("NoteQueries.list", () => {
  test("every note with its workspace, the latest change first", async () => {
    await save("own");
    clock.advance(1_000);
    await save("issue", { issue: "MOB-1" });
    db.run("DELETE FROM workspaces");
    const listed = notes.list();
    expect(listed).toMatchObject({
      ok: true,
      value: [
        { note: { issueKey: "MOB-1" }, workspace: null },
        { note: { issueKey: null }, workspace: null },
      ],
    });
  });
});

test("every recorded event decodes against the catalog", async () => {
  await save("one");
  await save("");
  const catalog = EventCatalog.create(NOTE_EVENTS);
  if (!catalog.ok) throw new Error(catalog.error.message);
  const page = ledger.list({ limit: 100 });
  if (!page.ok) throw new Error(page.error.message);
  for (const event of page.value.events) expect(catalog.value.decode(event).ok).toBe(true);
});
