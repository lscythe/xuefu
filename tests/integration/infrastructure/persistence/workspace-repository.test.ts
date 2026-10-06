import type { Database } from "bun:sqlite";
import { beforeEach, describe, expect, test } from "bun:test";
import type { WorkspaceId } from "../../../../src/domain/shared/ids";
import type { AbsolutePath } from "../../../../src/domain/shared/path";
import type { Timestamp } from "../../../../src/domain/shared/time";
import {
  addWorkspace,
  assignGroup,
  EMPTY_REGISTRY,
  type NewWorkspace,
  removeWorkspace,
  type WorkspaceRegistry,
} from "../../../../src/domain/workspace/registry";
import type { GroupName, WorkspaceName } from "../../../../src/domain/workspace/workspace";
import { SqliteWorkspaceRepository } from "../../../../src/infrastructure/persistence/sqlite/workspace-repository";
import { migratedMemoryDatabase } from "../../../support/database";

const AT = 1_760_000_000_000 as Timestamp;

let db: Database;
let repository: SqliteWorkspaceRepository;
beforeEach(() => {
  db = migratedMemoryDatabase();
  repository = new SqliteWorkspaceRepository(db);
});

function candidate(path: string, name: string): NewWorkspace {
  return { name: name as WorkspaceName, path: path as AbsolutePath, group: null };
}

function add(registry: WorkspaceRegistry, input: NewWorkspace): WorkspaceRegistry {
  const result = addWorkspace(registry, input, AT);
  if (!result.ok) throw new Error(result.error.message);
  return result.value.registry;
}

function saved(registry: WorkspaceRegistry): WorkspaceRegistry {
  const result = repository.save(registry);
  if (!result.ok) throw new Error(result.error.message);
  const loaded = repository.load();
  if (!loaded.ok) throw new Error(loaded.error.message);
  return loaded.value;
}

describe("SqliteWorkspaceRepository", () => {
  test("a fresh database has no workspaces", () => {
    expect(repository.load()).toEqual({ ok: true, value: EMPTY_REGISTRY });
  });

  test("round-trips workspaces in display order", () => {
    let registry = add(EMPTY_REGISTRY, candidate("/work/mobile", "Mobile Banking"));
    registry = add(registry, candidate("/work/项目", "血符"));
    const grouped = assignGroup(registry, "mobile-banking" as WorkspaceId, "Client" as GroupName);
    if (!grouped.ok) throw new Error("group");
    expect(saved(grouped.value.registry)).toEqual(grouped.value.registry);
  });

  test("saving drops removed workspaces and keeps the rest in order", () => {
    let registry = add(EMPTY_REGISTRY, candidate("/a", "A"));
    registry = add(registry, candidate("/b", "B"));
    registry = add(registry, candidate("/c", "C"));
    saved(registry);
    const removed = removeWorkspace(registry, "b" as WorkspaceId);
    if (!removed.ok) throw new Error("remove");
    expect(saved(removed.value.registry).workspaces.map((w) => w.id)).toEqual([
      "a",
      "c",
    ] as WorkspaceId[]);
  });

  test("a path freed by a removal can be reused in the same save", () => {
    const registry = saved(add(EMPTY_REGISTRY, candidate("/a", "Old")));
    const removed = removeWorkspace(registry, "old" as WorkspaceId);
    if (!removed.ok) throw new Error("remove");
    const replaced = add(removed.value.registry, candidate("/a", "New"));
    expect(saved(replaced).workspaces.map((w) => w.id)).toEqual(["new"] as WorkspaceId[]);
  });

  test("a failed save changes nothing", () => {
    const registry = saved(add(EMPTY_REGISTRY, candidate("/a", "A")));
    const broken = {
      workspaces: [
        ...registry.workspaces,
        { ...registry.workspaces[0], id: "dupe-path" } as (typeof registry.workspaces)[number],
      ],
    };
    const result = repository.save(broken);
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.error).toMatchObject({ kind: "storage", operation: "workspaces.save" });
    expect(repository.load()).toEqual({ ok: true, value: registry });
  });

  test("corrupt rows are reported instead of being loaded", () => {
    db.run(
      "INSERT INTO workspaces (id, name, path, group_name, position, added_at) VALUES (?, ?, ?, ?, ?, ?)",
      ["Not An Id", "x", "/x", null, 0, 0],
    );
    const result = repository.load();
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.error).toMatchObject({ kind: "storage", operation: "workspaces.read" });
  });

  test("the schema rejects relative paths and duplicate paths", () => {
    const insert = (id: string, path: string) =>
      db.run(
        "INSERT INTO workspaces (id, name, path, group_name, position, added_at) VALUES (?, ?, ?, NULL, 0, 0)",
        [id, id, path],
      );
    expect(() => insert("rel", "relative/path")).toThrow();
    insert("one", "/same");
    expect(() => insert("two", "/same")).toThrow();
  });

  test("storage failures surface as storage errors", () => {
    db.close();
    const loaded = repository.load();
    expect(loaded.ok).toBe(false);
    if (!loaded.ok) expect(loaded.error.kind).toBe("storage");
    const save = repository.save(EMPTY_REGISTRY);
    expect(save.ok).toBe(false);
  });
});
