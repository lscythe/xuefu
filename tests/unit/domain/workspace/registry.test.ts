import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import { type WorkspaceId, workspaceId } from "../../../../src/domain/shared/ids";
import type { AbsolutePath } from "../../../../src/domain/shared/path";
import type { Timestamp } from "../../../../src/domain/shared/time";
import {
  activateWorkspace,
  addWorkspace,
  assignGroup,
  createRegistry,
  EMPTY_REGISTRY,
  findWorkspace,
  lastActiveWorkspace,
  type NewWorkspace,
  removeWorkspace,
  type WorkspaceRegistry,
  workspaceAt,
} from "../../../../src/domain/workspace/registry";
import type {
  GroupName,
  Workspace,
  WorkspaceName,
} from "../../../../src/domain/workspace/workspace";

const AT = 1_760_000_000_000 as Timestamp;

function candidate(path: string, name = path.split("/").at(-1) ?? "root"): NewWorkspace {
  return {
    name: name as WorkspaceName,
    path: path as AbsolutePath,
    group: null,
  };
}

function add(registry: WorkspaceRegistry, input: NewWorkspace): WorkspaceRegistry {
  const result = addWorkspace(registry, input, AT);
  if (!result.ok) throw new Error(result.error.message);
  return result.value.registry;
}

function ids(registry: WorkspaceRegistry): string[] {
  return registry.workspaces.map((w) => w.id);
}

describe("addWorkspace", () => {
  test("derives the id from the name and appends in order", () => {
    const first = addWorkspace(EMPTY_REGISTRY, candidate("/work/mobile", "Mobile Banking"), AT);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.value.workspace).toEqual({
      id: "mobile-banking" as WorkspaceId,
      name: "Mobile Banking" as WorkspaceName,
      path: "/work/mobile" as AbsolutePath,
      group: null,
      addedAt: AT,
      lastActiveAt: null,
    });
    const second = add(first.value.registry, candidate("/work/auth", "Auth"));
    expect(ids(second)).toEqual(["mobile-banking", "auth"]);
  });

  test("falls back to the directory name, then to 'workspace'", () => {
    const fromDir = add(EMPTY_REGISTRY, candidate("/work/payments-api", "血符"));
    const fromNothing = add(fromDir, candidate("/work/项目", "血符"));
    expect(ids(fromNothing)).toEqual(["payments-api", "workspace"]);
  });

  test("suffixes derived ids that are already taken", () => {
    let registry = add(EMPTY_REGISTRY, candidate("/a/app", "App"));
    registry = add(registry, candidate("/b/app", "App"));
    registry = add(registry, candidate("/c/app", "App"));
    expect(ids(registry)).toEqual(["app", "app-2", "app-3"]);
  });

  test("keeps suffixed ids within 64 characters", () => {
    const long = "x".repeat(64);
    let registry = add(EMPTY_REGISTRY, candidate("/a/long", long));
    registry = add(registry, candidate("/b/long", long));
    const second = registry.workspaces[1];
    expect(second?.id).toBe(`${"x".repeat(62)}-2` as WorkspaceId);
  });

  test("an explicit id is used as given", () => {
    const registry = add(EMPTY_REGISTRY, {
      ...candidate("/work/mobile", "Mobile"),
      id: "mob" as WorkspaceId,
    });
    expect(ids(registry)).toEqual(["mob"]);
  });

  test("an explicit id that is taken is a conflict", () => {
    const registry = add(EMPTY_REGISTRY, candidate("/work/mobile", "Mobile"));
    const result = addWorkspace(
      registry,
      { ...candidate("/work/other"), id: "mobile" as WorkspaceId },
      AT,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatchObject({ kind: "conflict", entity: "workspace", key: "mobile" });
    }
  });

  test("a path that is already registered is a conflict naming the owner", () => {
    const registry = add(EMPTY_REGISTRY, candidate("/work/mobile", "Mobile"));
    const result = addWorkspace(registry, candidate("/work/mobile", "Again"), AT);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatchObject({ kind: "conflict", key: "/work/mobile" });
      expect(result.error.message).toContain("mobile");
    }
  });

  test("nested workspaces are allowed", () => {
    let registry = add(EMPTY_REGISTRY, candidate("/work/mono", "Mono"));
    registry = add(registry, candidate("/work/mono/apps/android", "Android"));
    expect(ids(registry)).toEqual(["mono", "android"]);
  });

  test("returned registries and workspaces are frozen", () => {
    const result = addWorkspace(EMPTY_REGISTRY, candidate("/work/mobile"), AT);
    if (!result.ok) throw new Error("unexpected");
    expect(Object.isFrozen(result.value.registry)).toBe(true);
    expect(Object.isFrozen(result.value.registry.workspaces)).toBe(true);
    expect(Object.isFrozen(result.value.workspace)).toBe(true);
  });
});

describe("removeWorkspace", () => {
  test("removes by id and keeps the order of the rest", () => {
    let registry = add(EMPTY_REGISTRY, candidate("/a", "A"));
    registry = add(registry, candidate("/b", "B"));
    registry = add(registry, candidate("/c", "C"));
    const result = removeWorkspace(registry, "b" as WorkspaceId);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.removed.id).toBe("b" as WorkspaceId);
    expect(ids(result.value.registry)).toEqual(["a", "c"]);
  });

  test("an unknown id is not found", () => {
    const result = removeWorkspace(EMPTY_REGISTRY, "ghost" as WorkspaceId);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatchObject({ kind: "not-found", key: "ghost" });
  });
});

describe("assignGroup", () => {
  test("sets and clears the group without moving the workspace", () => {
    let registry = add(EMPTY_REGISTRY, candidate("/a", "A"));
    registry = add(registry, candidate("/b", "B"));
    const grouped = assignGroup(registry, "a" as WorkspaceId, "Client" as GroupName);
    if (!grouped.ok) throw new Error(grouped.error.message);
    expect(grouped.value.workspace.group).toBe("Client" as GroupName);
    expect(ids(grouped.value.registry)).toEqual(["a", "b"]);

    const cleared = assignGroup(grouped.value.registry, "a" as WorkspaceId, null);
    if (!cleared.ok) throw new Error(cleared.error.message);
    expect(cleared.value.workspace.group).toBeNull();
  });

  test("an unknown id is not found", () => {
    expect(assignGroup(EMPTY_REGISTRY, "ghost" as WorkspaceId, null).ok).toBe(false);
  });
});

describe("findWorkspace", () => {
  test("finds by id or reports not found", () => {
    const registry = add(EMPTY_REGISTRY, candidate("/a", "A"));
    expect(findWorkspace(registry, "a" as WorkspaceId).ok).toBe(true);
    const missing = findWorkspace(registry, "b" as WorkspaceId);
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.error.kind).toBe("not-found");
  });
});

describe("workspaceAt", () => {
  const registry = [
    candidate("/work/mono", "Mono"),
    candidate("/work/mono/apps/android", "Android"),
    candidate("/work/mobile", "Mobile"),
  ].reduce(add, EMPTY_REGISTRY);

  test.each([
    ["/work/mono", "mono"],
    ["/work/mono/libs/core", "mono"],
    ["/work/mono/apps/android/app/src", "android"],
    ["/work/mobile", "mobile"],
  ])("%p belongs to %p", (path, expected) => {
    expect(workspaceAt(registry, path as AbsolutePath)?.id).toBe(expected as WorkspaceId);
  });

  test.each(["/work", "/work/mobile-banking", "/elsewhere"])("%p belongs to none", (path) => {
    expect(workspaceAt(registry, path as AbsolutePath)).toBeNull();
  });
});

describe("activateWorkspace and lastActiveWorkspace", () => {
  const later = (ms: number) => (AT + ms) as Timestamp;
  const activate = (registry: WorkspaceRegistry, id: string, at: Timestamp) => {
    const result = activateWorkspace(registry, id as WorkspaceId, at);
    if (!result.ok) throw new Error(result.error.message);
    return result.value;
  };
  const three = add(add(add(EMPTY_REGISTRY, candidate("/a")), candidate("/b")), candidate("/c"));

  test("nothing has been active in a fresh registry", () => {
    expect(lastActiveWorkspace(three)).toBeNull();
    expect(lastActiveWorkspace(EMPTY_REGISTRY)).toBeNull();
  });

  test("stamps the activation time without reordering", () => {
    const { registry, workspace } = activate(three, "b", later(1));
    expect(workspace.lastActiveAt).toBe(later(1));
    expect(ids(registry)).toEqual(["a", "b", "c"]);
    expect(registry.workspaces[0]?.lastActiveAt).toBeNull();
  });

  test("the most recently activated workspace wins", () => {
    let registry = activate(three, "c", later(1)).registry;
    registry = activate(registry, "a", later(2)).registry;
    expect(lastActiveWorkspace(registry)?.id).toBe("a" as WorkspaceId);
    registry = activate(registry, "c", later(3)).registry;
    expect(lastActiveWorkspace(registry)?.id).toBe("c" as WorkspaceId);
  });

  test("activating an unknown workspace is not found", () => {
    const result = activateWorkspace(three, "ghost" as WorkspaceId, later(1));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatchObject({ kind: "not-found", key: "ghost" });
  });
});

describe("createRegistry", () => {
  const workspace = (id: string, path: string): Workspace => ({
    id: id as WorkspaceId,
    name: id as WorkspaceName,
    path: path as AbsolutePath,
    group: null,
    addedAt: AT,
    lastActiveAt: null,
  });

  test("accepts consistent data", () => {
    const result = createRegistry([workspace("a", "/a"), workspace("b", "/b")]);
    expect(result.ok).toBe(true);
    if (result.ok) expect(ids(result.value)).toEqual(["a", "b"]);
  });

  test("rejects duplicate ids", () => {
    const result = createRegistry([workspace("a", "/a"), workspace("a", "/b")]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatchObject({ kind: "conflict", key: "a" });
  });

  test("rejects duplicate paths", () => {
    const result = createRegistry([workspace("a", "/a"), workspace("b", "/a")]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatchObject({ kind: "conflict", key: "/a" });
  });
});

describe("registry invariants", () => {
  const segment = fc.constantFrom("a", "b", "c", "app", "mono");
  const pathArb = fc
    .array(segment, { minLength: 1, maxLength: 3 })
    .map((s) => `/${s.join("/")}` as AbsolutePath);
  const nameArb = fc.oneof(
    fc.constantFrom("App", "app", "Mono", "血符", "Payments API", "y".repeat(64), "z-".repeat(32)),
    fc.string({ maxLength: 80 }),
  );
  const operation = fc.oneof(
    fc.record({ op: fc.constant("add" as const), path: pathArb, name: nameArb }),
    fc.record({ op: fc.constant("remove" as const), index: fc.nat(10) }),
  );

  test("property: ids stay valid and ids and paths stay unique under adds and removes", () => {
    fc.assert(
      fc.property(fc.array(operation, { maxLength: 30 }), (operations) => {
        let registry = EMPTY_REGISTRY;
        for (const step of operations) {
          if (step.op === "add") {
            const result = addWorkspace(registry, candidate(step.path, step.name), AT);
            if (result.ok) registry = result.value.registry;
          } else {
            const target = registry.workspaces[step.index];
            if (target !== undefined) {
              const result = removeWorkspace(registry, target.id);
              if (result.ok) registry = result.value.registry;
            }
          }
        }
        const allIds = registry.workspaces.map((w) => w.id);
        const allPaths = registry.workspaces.map((w) => w.path);
        for (const id of allIds) expect(workspaceId(id).ok).toBe(true);
        expect(new Set(allIds).size).toBe(allIds.length);
        expect(new Set(allPaths).size).toBe(allPaths.length);
        expect(createRegistry(registry.workspaces).ok).toBe(true);
      }),
    );
  });
});
