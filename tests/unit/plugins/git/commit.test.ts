import { describe, expect, test } from "bun:test";
import { ok } from "../../../../src/domain/shared/result";
import {
  type CommitMessage,
  commitMessage,
  commitSubject,
  repositoryPath,
} from "../../../../src/plugins/git/domain/commit";

describe("commitMessage", () => {
  test("keeps the text as written, minus blank lines before and whitespace after", () => {
    expect(commitMessage("\n  \nFix login\r\n\r\nDetails here.  \n\n")).toEqual(
      ok("Fix login\n\nDetails here." as CommitMessage),
    );
  });

  test.each([
    ["", "write a summary of the change"],
    [" \n\t\n", "write a summary of the change"],
    ["x".repeat(20_001), "must be at most 20000 characters"],
    ["Fix\u0007", "must not contain control characters other than tabs"],
  ])("%# refuses it: %s", (raw, problem) => {
    const parsed = commitMessage(raw);
    expect(parsed.ok ? null : parsed.error.issues).toEqual([{ path: "message", message: problem }]);
  });

  test("the subject is the first line", () => {
    expect(commitSubject("Fix login\n\nDetails" as CommitMessage)).toBe("Fix login");
    expect(commitSubject("Fix login" as CommitMessage)).toBe("Fix login");
  });
});

describe("repositoryPath", () => {
  test.each(["README.md", "app/src/main.kt", "app/", "odd [1].txt", "..hidden"])(
    "accepts %s",
    (raw) => {
      expect(repositoryPath(raw)).toEqual(ok(raw));
    },
  );

  test.each([
    ["", "must not be empty"],
    ["/etc/passwd", "must stay inside the repository"],
    ["app/../../secret", "must stay inside the repository"],
    ["a\0b", "must not contain NUL"],
    ["a".repeat(4097), "must be at most 4096 characters"],
  ])("refuses %j: %s", (raw, problem) => {
    const parsed = repositoryPath(raw);
    expect(parsed.ok ? null : parsed.error.issues[0]?.message).toBe(problem);
  });
});
