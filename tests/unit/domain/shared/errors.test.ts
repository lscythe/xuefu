import { describe, expect, test } from "bun:test";
import { assertNever } from "../../../../src/domain/shared/assert-never";
import {
  type CoreError,
  cancelled,
  describeCause,
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

  test("CoreError kinds can be handled exhaustively", () => {
    const label = (e: CoreError): string => {
      switch (e.kind) {
        case "validation":
        case "configuration":
        case "storage":
        case "migration":
        case "filesystem":
        case "command-not-found":
        case "duplicate-command":
        case "confirmation-required":
        case "cancelled":
        case "timeout":
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
