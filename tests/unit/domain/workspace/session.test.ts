import { describe, expect, test } from "bun:test";
import { type NavigationKey, navigationKey } from "../../../../src/domain/workspace/session";

describe("navigationKey", () => {
  test.each(["dashboard", "pulls", "work", "a", "git-log", `a${"b".repeat(31)}`])(
    "accepts %p",
    (raw) => {
      expect(navigationKey(raw)).toEqual({ ok: true, value: raw as NavigationKey });
    },
  );

  test.each(["", "Dashboard", "1st", "-x", "a b", "work/notes", `a${"b".repeat(32)}`])(
    "rejects %p",
    (raw) => {
      const result = navigationKey(raw);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.kind).toBe("validation");
    },
  );
});
