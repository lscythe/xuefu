import { describe, expect, test } from "bun:test";
import { assertNever } from "../../../../src/domain/shared/assert-never";
import {
  type CoreError,
  cancelled,
  conflict,
  describeCause,
  notFound,
  processError,
  timeout,
  unexpected,
  validationError,
} from "../../../../src/domain/shared/errors";

describe("errors", () => {
  test("validationError carries issues and is frozen", () => {
    const error = validationError("Invalid issue key", [{ path: "key", message: "bad format" }], {
      input: "mob-1",
    });
    expect(error).toEqual({
      kind: "validation",
      message: "Invalid issue key",
      issues: [{ path: "key", message: "bad format" }],
      context: { input: "mob-1" },
    });
    expect(Object.isFrozen(error)).toBe(true);
  });

  test("describeCause summarises Error instances without keeping the object", () => {
    const cause = describeCause(new TypeError("bad thing"));
    expect(cause).toEqual({ name: "TypeError", message: "bad thing" });
  });

  test("describeCause handles non-Error throwables", () => {
    expect(describeCause("str")).toEqual({ name: "NonError", message: "str" });
    expect(describeCause({ weird: true })).toEqual({ name: "NonError", message: "[object]" });
    expect(describeCause(undefined)).toEqual({ name: "NonError", message: "undefined" });
  });

  test("unexpected wraps a thrown value with a summarised cause", () => {
    const error = unexpected("Handler crashed", new Error("kaboom"));
    expect(error.kind).toBe("unexpected");
    expect(error.cause).toEqual({ name: "Error", message: "kaboom" });
  });

  test("optional fields are omitted rather than set to undefined", () => {
    const error = cancelled("User cancelled");
    expect("hint" in error).toBe(false);
    expect("cause" in error).toBe(false);
  });

  test("notFound names the missing entity and key", () => {
    const error = notFound("workspace", "mobile-banking", { hint: "Run: xuefu workspace list" });
    expect(error).toEqual({
      kind: "not-found",
      message: "No workspace named mobile-banking",
      entity: "workspace",
      key: "mobile-banking",
      context: { entity: "workspace", key: "mobile-banking" },
      hint: "Run: xuefu workspace list",
    });
    expect(Object.isFrozen(error)).toBe(true);
  });

  test("conflict names the entity and the clashing key", () => {
    const error = conflict("Path is already registered", "workspace", "/work/mobile");
    expect(error).toMatchObject({
      kind: "conflict",
      message: "Path is already registered",
      entity: "workspace",
      key: "/work/mobile",
      context: { entity: "workspace", key: "/work/mobile" },
    });
    expect(Object.isFrozen(error)).toBe(true);
  });

  test("a process error names the program and how it ended, never its arguments", () => {
    const error = processError("git failed", "git", 128, { hint: "Is it a repository?" });
    expect(error).toMatchObject({
      kind: "process",
      message: "git failed",
      command: "git",
      exitCode: 128,
      hint: "Is it a repository?",
      context: { command: "git", exitCode: 128 },
    });
    expect(Object.isFrozen(error)).toBe(true);
  });

  test("CoreError kinds can be handled exhaustively", () => {
    const label = (e: CoreError): string => {
      switch (e.kind) {
        case "validation":
        case "configuration":
        case "storage":
        case "migration":
        case "filesystem":
        case "not-found":
        case "conflict":
        case "command-not-found":
        case "duplicate-command":
        case "confirmation-required":
        case "cancelled":
        case "timeout":
        case "process":
        case "unexpected":
          return e.kind;
        default:
          return assertNever(e);
      }
    };
    expect(label(timeout("slow", 100))).toBe("timeout");
  });

  test("assertNever throws for impossible values reaching runtime", () => {
    expect(() => assertNever("surprise" as never)).toThrow("Unexpected value: surprise");
  });
});
