import { describe, expect, test } from "bun:test";
import { type IssueKey, issueKey } from "../../../../src/domain/work/issue-key";

describe("issueKey", () => {
  test.each([
    ["MOB-2841", "MOB-2841"],
    ["mob-2841", "MOB-2841"],
    ["  Ab1_X-7 ", "AB1_X-7"],
    ["A-1", "A-1"],
    ["ABCDEFGHIJ-1234567890", "ABCDEFGHIJ-1234567890"],
  ])("accepts %p as %p", (raw, key) => {
    expect(issueKey(raw)).toEqual({ ok: true, value: key as IssueKey });
  });

  test.each(["", "MOB", "MOB-", "-12", "1MOB-2", "MOB-0", "MOB-012", "MOB 12", "ABCDEFGHIJK-1"])(
    "rejects %p",
    (raw) => {
      expect(issueKey(raw)).toMatchObject({
        ok: false,
        error: { kind: "validation", issues: [{ path: "issue" }] },
      });
    },
  );
});
