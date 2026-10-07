import type { Database } from "bun:sqlite";
import { beforeEach, describe, expect, test } from "bun:test";
import type { WorkspaceId } from "../../../../src/domain/shared/ids";
import type { Timestamp } from "../../../../src/domain/shared/time";
import type { NavigationKey } from "../../../../src/domain/workspace/session";
import { SqliteWorkspaceSessionRepository } from "../../../../src/infrastructure/persistence/sqlite/workspace-session-repository";
import { migratedMemoryDatabase } from "../../../support/database";

const AT = 1_760_000_000_000 as Timestamp;
const id = (raw: string) => raw as WorkspaceId;
const key = (raw: string) => raw as NavigationKey;

let db: Database;
let sessions: SqliteWorkspaceSessionRepository;
beforeEach(() => {
  db = migratedMemoryDatabase();
  sessions = new SqliteWorkspaceSessionRepository(db);
  for (const workspace of ["a", "b"]) {
    db.run(
      `INSERT INTO workspaces (id, name, path, group_name, position, added_at)
       VALUES (?, ?, ?, NULL, (SELECT count(*) FROM workspaces), 0)`,
      [workspace, workspace, `/work/${workspace}`],
    );
  }
});

describe("SqliteWorkspaceSessionRepository", () => {
  test("remembers the latest navigation per workspace", () => {
    expect(sessions.navigation()).toEqual({ ok: true, value: new Map() });
    sessions.saveNavigation(id("a"), key("work"), AT);
    sessions.saveNavigation(id("b"), key("git"), AT);
    sessions.saveNavigation(id("a"), key("pulls"), AT);
    expect(sessions.navigation()).toEqual({
      ok: true,
      value: new Map([
        [id("a"), key("pulls")],
        [id("b"), key("git")],
      ]),
    });
  });

  test("a removed workspace takes its session with it; unknown workspaces are refused", () => {
    sessions.saveNavigation(id("a"), key("work"), AT);
    db.run("DELETE FROM workspaces WHERE id = 'a'");
    expect(sessions.navigation()).toEqual({ ok: true, value: new Map() });
    expect(sessions.saveNavigation(id("ghost"), key("work"), AT)).toMatchObject({
      ok: false,
      error: { operation: "workspace_sessions.save" },
    });
  });

  test("corrupt rows and storage failures surface as storage errors", () => {
    db.run(
      "INSERT INTO workspace_sessions (workspace_id, navigation, updated_at) VALUES ('a', 'Not Valid', 0)",
    );
    expect(sessions.navigation()).toMatchObject({ ok: false, error: { kind: "storage" } });
    db.close();
    expect(sessions.navigation()).toMatchObject({
      ok: false,
      error: { operation: "workspace_sessions.read" },
    });
  });
});
