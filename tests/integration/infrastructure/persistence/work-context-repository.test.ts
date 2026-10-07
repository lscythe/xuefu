import type { Database } from "bun:sqlite";
import { beforeEach, describe, expect, test } from "bun:test";
import type { WorkId, WorkspaceId } from "../../../../src/domain/shared/ids";
import type { Timestamp } from "../../../../src/domain/shared/time";
import type { IssueKey } from "../../../../src/domain/work/issue-key";
import {
  finishWork,
  type IssueTitle,
  startWork,
  type WorkContext,
} from "../../../../src/domain/work/work-context";
import { SqliteWorkContextRepository } from "../../../../src/infrastructure/persistence/sqlite/work-context-repository";
import { migratedMemoryDatabase } from "../../../support/database";

const AT = 1_760_000_000_000 as Timestamp;
const work = (id: string, workspace: string, issue = "MOB-1", title: string | null = null) =>
  startWork(
    {
      id: id as WorkId,
      workspaceId: workspace as WorkspaceId,
      issueKey: issue as IssueKey,
      title: title as IssueTitle | null,
    },
    AT,
  );
const finished = (w: WorkContext) => {
  const done = finishWork(w, (AT + 1000) as Timestamp);
  if (!done.ok) throw new Error("expected ok");
  return done.value;
};

let db: Database;
let contexts: SqliteWorkContextRepository;
beforeEach(() => {
  db = migratedMemoryDatabase();
  contexts = new SqliteWorkContextRepository(db);
});

describe("SqliteWorkContextRepository", () => {
  test("keeps open work per workspace and finished work as history", () => {
    expect(contexts.open()).toEqual({ ok: true, value: new Map() });
    const a = work("w1", "a", "MOB-1", "Biometrics");
    const b = work("w2", "b", "PAY-7");
    contexts.save(a);
    contexts.save(b);
    expect(contexts.open()).toEqual({
      ok: true,
      value: new Map([
        ["a" as WorkspaceId, a],
        ["b" as WorkspaceId, b],
      ]),
    });
    contexts.save(finished(a));
    expect(contexts.open()).toEqual({ ok: true, value: new Map([["b" as WorkspaceId, b]]) });
    expect(db.query("SELECT count(*) AS n FROM work_contexts").get()).toEqual({ n: 2 });
  });

  test("saving again updates the title", () => {
    contexts.save(work("w1", "a"));
    const retitled = work("w1", "a", "MOB-1", "Renamed");
    contexts.save(retitled);
    expect(contexts.open()).toMatchObject({ ok: true, value: new Map([["a", retitled]]) });
  });

  test("storage refuses a second open context in one workspace", () => {
    contexts.save(work("w1", "a"));
    expect(contexts.save(work("w2", "a", "MOB-2"))).toMatchObject({
      ok: false,
      error: { kind: "storage", operation: "work_contexts.save" },
    });
  });

  test("corrupt rows and a closed database surface as storage errors", () => {
    contexts.save(work("w1", "a"));
    db.run("UPDATE work_contexts SET issue_key = 'nope'");
    expect(contexts.open()).toMatchObject({
      ok: false,
      error: { message: "A stored work context is corrupt" },
    });
    db.run("UPDATE work_contexts SET issue_key = 'MOB-1', workspace_id = 'Bad'");
    expect(contexts.open().ok).toBe(false);
    db.close();
    expect(contexts.open()).toMatchObject({
      ok: false,
      error: { operation: "work_contexts.read" },
    });
  });

  test("rows of the wrong shape are corrupt", () => {
    const loose = migratedMemoryDatabase();
    loose.run("DROP TABLE work_contexts");
    loose.run(
      "CREATE TABLE work_contexts (id, workspace_id, issue_key, title, started_at, ended_at)",
    );
    loose.run("INSERT INTO work_contexts VALUES ('w1', 'a', 'MOB-1', NULL, 'soon', NULL)");
    expect(new SqliteWorkContextRepository(loose).open()).toMatchObject({
      ok: false,
      error: { kind: "storage" },
    });
  });
});
