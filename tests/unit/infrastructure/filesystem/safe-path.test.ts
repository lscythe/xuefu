import { describe, expect, test } from "bun:test";
import { sep } from "node:path";
import fc from "fast-check";
import { expandHome, resolveWithin } from "../../../../src/infrastructure/filesystem/safe-path";

const ROOT = "/home/dev/.local/share/xuefu";

describe("resolveWithin", () => {
  test.each([
    ["exports/2026-10.csv", `${ROOT}/exports/2026-10.csv`],
    ["./a/../b.txt", `${ROOT}/b.txt`],
    [".", ROOT],
  ])("allows %p", (candidate, expected) => {
    expect(resolveWithin(ROOT, candidate)).toEqual({ ok: true, value: expected });
  });

  test.each(["../escape", "a/../../escape", "/etc/passwd", "exports/\u0000evil"])(
    "rejects %p",
    (candidate) => {
      const result = resolveWithin(ROOT, candidate);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.kind).toBe("filesystem");
    },
  );

  test("rejects a relative root", () => {
    expect(resolveWithin("relative/root", "x").ok).toBe(false);
  });

  test("a sibling directory sharing the root prefix is outside the root", () => {
    expect(resolveWithin(ROOT, "../xuefu-evil/x").ok).toBe(false);
  });

  test("property: every accepted path stays inside the root", () => {
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom("a", "b", "..", ".", "", "c.txt", "/", "~"), { maxLength: 8 }),
        (segments) => {
          const result = resolveWithin(ROOT, segments.join("/"));
          if (result.ok) {
            expect(result.value === ROOT || result.value.startsWith(ROOT + sep)).toBe(true);
          }
        },
      ),
    );
  });
});

describe("expandHome", () => {
  test.each([
    ["~", "/Users/dev"],
    ["~/templates/company.xlsx", "/Users/dev/templates/company.xlsx"],
    ["/abs/path", "/abs/path"],
    ["relative/path", "relative/path"],
    ["~other/x", "~other/x"],
  ])("%s → %s", (input, expected) => {
    expect(expandHome(input, "/Users/dev")).toBe(expected);
  });
});
