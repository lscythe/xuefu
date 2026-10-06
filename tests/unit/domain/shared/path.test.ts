import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import {
  type AbsolutePath,
  absolutePath,
  baseName,
  isSameOrWithin,
} from "../../../../src/domain/shared/path";

function path(raw: string): AbsolutePath {
  const result = absolutePath(raw);
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

const segment = fc
  .string({ minLength: 1, maxLength: 12 })
  .filter((s) => !s.includes("/") && !s.includes("\0") && s !== "." && s !== "..");

describe("AbsolutePath", () => {
  test.each(["/", "/Users/dev/mobile-banking", "/tmp/a b/c", "/srv/项目", "/a/.hidden"])(
    "accepts %p",
    (raw) => {
      expect(absolutePath(raw)).toEqual({ ok: true, value: raw as AbsolutePath });
    },
  );

  test.each([
    ["", "absolute"],
    ["relative/path", "absolute"],
    ["~/projects", "absolute"],
    ["/a//b", "normalised"],
    ["/a/./b", "normalised"],
    ["/a/../b", "normalised"],
    ["/a/b/", "normalised"],
    ["/a\0b", "NUL"],
  ])("rejects %p", (raw, reason) => {
    const result = absolutePath(raw);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("validation");
      expect(result.error.issues[0]?.message).toContain(reason);
    }
  });

  test("rejects paths longer than 4096 characters", () => {
    expect(absolutePath(`/${"a".repeat(4096)}`).ok).toBe(false);
  });

  test("property: any path built from clean segments is accepted unchanged", () => {
    fc.assert(
      fc.property(fc.array(segment, { minLength: 1, maxLength: 6 }), (segments) => {
        const raw = `/${segments.join("/")}`;
        expect(absolutePath(raw)).toEqual({ ok: true, value: raw as AbsolutePath });
      }),
    );
  });
});

describe("isSameOrWithin", () => {
  test("a path is within itself and its ancestors", () => {
    const repo = path("/work/mobile");
    expect(isSameOrWithin(repo, repo)).toBe(true);
    expect(isSameOrWithin(path("/work/mobile/app/src"), repo)).toBe(true);
    expect(isSameOrWithin(repo, path("/"))).toBe(true);
  });

  test("a sibling sharing a string prefix is not within", () => {
    expect(isSameOrWithin(path("/work/mobile-banking"), path("/work/mobile"))).toBe(false);
  });

  test("an ancestor is not within its descendant", () => {
    expect(isSameOrWithin(path("/work"), path("/work/mobile"))).toBe(false);
  });

  test("property: appending segments always stays within", () => {
    fc.assert(
      fc.property(
        fc.array(segment, { minLength: 1, maxLength: 4 }),
        fc.array(segment, { maxLength: 4 }),
        (base, extra) => {
          const ancestor = path(`/${base.join("/")}`);
          const child = path(`/${[...base, ...extra].join("/")}`);
          expect(isSameOrWithin(child, ancestor)).toBe(true);
        },
      ),
    );
  });
});

describe("baseName", () => {
  test("returns the last segment, or an empty string for the root", () => {
    expect(baseName(path("/work/mobile-banking"))).toBe("mobile-banking");
    expect(baseName(path("/"))).toBe("");
  });
});
