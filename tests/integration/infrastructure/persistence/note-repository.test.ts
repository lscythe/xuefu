import type { Database } from "bun:sqlite";
import { beforeEach, describe, expect, test } from "bun:test";
import type { Note, NoteBody } from "../../../../src/domain/notes/note";
import type { NoteId, WorkspaceId } from "../../../../src/domain/shared/ids";
import type { Timestamp } from "../../../../src/domain/shared/time";
import type { IssueKey } from "../../../../src/domain/work/issue-key";
import { SqliteNoteRepository } from "../../../../src/infrastructure/persistence/sqlite/note-repository";
import { migratedMemoryDatabase } from "../../../support/database";

const note = (
  id: string,
  workspace: string,
  issue: string | null,
  body: string,
  updatedAt = 1_760_000_000_000,
): Note => ({
  id: id as NoteId,
  workspaceId: workspace as WorkspaceId,
  issueKey: issue as IssueKey | null,
  body: body as NoteBody,
  updatedAt: updatedAt as Timestamp,
});

let db: Database;
let notes: SqliteNoteRepository;
beforeEach(() => {
  db = migratedMemoryDatabase();
  notes = new SqliteNoteRepository(db);
});

const mobile = "mobile-banking" as WorkspaceId;

describe("SqliteNoteRepository", () => {
  test("finds the workspace's own note apart from its issues' notes", () => {
    const own = note("n1", "mobile-banking", null, "Staging needs the VPN");
    const issue = note("n2", "mobile-banking", "MOB-1", "Ask QA about the flaky test");
    notes.save(own);
    notes.save(issue);
    expect(notes.find(mobile, null)).toEqual({ ok: true, value: own });
    expect(notes.find(mobile, "MOB-1" as IssueKey)).toEqual({ ok: true, value: issue });
    expect(notes.find(mobile, "MOB-2" as IssueKey)).toEqual({ ok: true, value: null });
    expect(notes.find("auth" as WorkspaceId, null)).toEqual({ ok: true, value: null });
  });

  test("saving again replaces the text; removing forgets the note", () => {
    notes.save(note("n1", "mobile-banking", null, "first"));
    const edited = note("n1", "mobile-banking", null, "second\nline", 1_760_000_100_000);
    notes.save(edited);
    expect(notes.find(mobile, null)).toEqual({ ok: true, value: edited });
    expect(notes.remove("n1" as NoteId)).toEqual({ ok: true, value: undefined });
    expect(notes.find(mobile, null)).toEqual({ ok: true, value: null });
  });

  test("lists every note, the latest change first", () => {
    const older = note("n1", "a", null, "older", 1);
    const newer = note("n2", "b", "PAY-7", "newer", 2);
    notes.save(older);
    notes.save(newer);
    expect(notes.all()).toEqual({ ok: true, value: [newer, older] });
  });

  test("invariant: one note per workspace and issue, the workspace's own included", () => {
    notes.save(note("n1", "mobile-banking", null, "own"));
    expect(notes.save(note("n2", "mobile-banking", null, "again")).ok).toBe(false);
    notes.save(note("n3", "mobile-banking", "MOB-1", "issue"));
    expect(notes.save(note("n4", "mobile-banking", "MOB-1", "again")).ok).toBe(false);
  });

  test("corrupt rows and storage failures are errors", () => {
    db.run(
      `INSERT INTO notes (id, workspace_id, issue_key, body, updated_at)
       VALUES ('n9', 'Not An Id', NULL, 'x', 0)`,
    );
    expect(notes.all()).toMatchObject({
      ok: false,
      error: { message: "A stored note is corrupt" },
    });
    expect(notes.find("Not An Id" as WorkspaceId, null)).toMatchObject({ ok: false });
    db.run("DROP TABLE notes");
    for (const result of [
      notes.all(),
      notes.find(mobile, null),
      notes.save(note("n1", "a", null, "x")),
      notes.remove("n1" as NoteId),
    ]) {
      expect(result).toMatchObject({ ok: false, error: { kind: "storage" } });
    }
  });
});
