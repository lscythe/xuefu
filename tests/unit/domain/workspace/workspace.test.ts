import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import { workspaceId } from "../../../../src/domain/shared/ids";
import {
  type GroupName,
  groupName,
  suggestWorkspaceId,
  type WorkspaceName,
  workspaceName,
} from "../../../../src/domain/workspace/workspace";

describe("workspaceName", () => {
  test("trims surrounding whitespace", () => {
    expect(workspaceName("  Mobile Banking  ")).toEqual({
      ok: true,
      value: "Mobile Banking" as WorkspaceName,
    });
  });

  test("accepts non-ASCII names", () => {
    expect(workspaceName("血符 cockpit").ok).toBe(true);
  });

  test.each(["", "   ", "tab\there", "line\nbreak", "x".repeat(65)])("rejects %p", (raw) => {
    const result = workspaceName(raw);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toBe("Workspace name is invalid");
  });
});

describe("groupName", () => {
  test("trims and accepts short labels", () => {
    expect(groupName(" Client A ")).toEqual({ ok: true, value: "Client A" as GroupName });
  });

  test.each(["", "  ", "bell\u0007", "x".repeat(33)])("rejects %p", (raw) => {
    const result = groupName(raw);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toBe("Group name is invalid");
  });
});

describe("suggestWorkspaceId", () => {
  test.each([
    ["Mobile Banking", "mobile-banking"],
    ["auth_service v2", "auth-service-v2"],
    ["  --Crème Brûlée--  ", "creme-brulee"],
    ["API", "api"],
  ])("%p becomes %p", (name, expected) => {
    expect(suggestWorkspaceId(name)).toBe(expected);
  });

  test("returns null when nothing usable remains", () => {
    expect(suggestWorkspaceId("血符")).toBeNull();
    expect(suggestWorkspaceId("---")).toBeNull();
  });

  test("property: every suggestion is a valid workspace id", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 200 }), (name) => {
        const suggestion = suggestWorkspaceId(name);
        if (suggestion !== null) expect(workspaceId(suggestion).ok).toBe(true);
      }),
    );
  });
});
