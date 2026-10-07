import { describe, expect, test } from "bun:test";
import { notFound, validationError } from "../../../src/domain/shared/errors";
import { errorText } from "../../../src/tui/error-line";

describe("errorText", () => {
  test("adds the first reason input was rejected", () => {
    const error = validationError("Issue key is invalid", [
      { path: "issue", message: "must look like PROJ-123" },
      { path: "issue", message: "second" },
    ]);
    expect(errorText(error)).toBe("Issue key is invalid: must look like PROJ-123");
  });

  test("other errors, and validation without issues, show the message alone", () => {
    expect(errorText(notFound("workspace", "ghost"))).toBe("No workspace named ghost");
    expect(errorText(validationError("Bad input", []))).toBe("Bad input");
  });
});
