import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import { fuzzyMatch, rankFuzzy } from "../../../../src/application/search/fuzzy";

const fold = (c: string) => c.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();

describe("fuzzyMatch", () => {
  test("an empty query matches anything with no highlighted positions", () => {
    expect(fuzzyMatch("", "mobile-banking")).toEqual({ score: 0, positions: [] });
  });

  test("returns null when the query is not a subsequence", () => {
    expect(fuzzyMatch("xyz", "mobile-banking")).toBeNull();
    expect(fuzzyMatch("bm", "mobile-banking")).toBeNull();
    expect(fuzzyMatch("mm", "mobile")).toBeNull();
  });

  test("ignores case and accents", () => {
    expect(fuzzyMatch("CREME", "Crème Brûlée")?.positions).toEqual([0, 1, 2, 3, 4]);
    expect(fuzzyMatch("brul", "Crème Brûlée")?.positions).toEqual([6, 7, 8, 9]);
  });

  test("prefers word starts over the leftmost scattered letters", () => {
    expect(fuzzyMatch("mb", "mobile-banking")?.positions).toEqual([0, 7]);
    expect(fuzzyMatch("as", "auth-service")?.positions).toEqual([0, 5]);
  });

  test("prefers a consecutive run", () => {
    expect(fuzzyMatch("bank", "mobile-banking")?.positions).toEqual([7, 8, 9, 10]);
  });

  test("positions count code points, so CJK and emoji line up with the text", () => {
    expect(fuzzyMatch("符", "血符 App")?.positions).toEqual([1]);
    expect(fuzzyMatch("a", "😀a")?.positions).toEqual([1]);
  });

  test("property: positions are increasing and spell the query", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 20 }), fc.string({ maxLength: 6 }), (text, query) => {
        const match = fuzzyMatch(query, text);
        if (match === null) return;
        const chars = Array.from(text);
        const spelled = match.positions.map((p) => fold(chars[p] ?? ""));
        expect(spelled.join("")).toBe(Array.from(query).map(fold).join(""));
        for (let i = 1; i < match.positions.length; i++) {
          expect(match.positions[i] ?? 0).toBeGreaterThan(match.positions[i - 1] ?? 0);
        }
      }),
    );
  });

  test("property: any subsequence of the text matches", () => {
    fc.assert(
      fc.property(
        fc.stringMatching(/^[a-z0-9-]{1,24}$/),
        fc.array(fc.boolean(), { maxLength: 24 }),
        (text, keep) => {
          const query = Array.from(text)
            .filter((_, i) => keep[i] === true)
            .join("");
          expect(fuzzyMatch(query, text)).not.toBeNull();
        },
      ),
    );
  });
});

describe("rankFuzzy", () => {
  const names = ["mobile-common", "deployd", "mobile-wallet", "mobile-banking", "auth-service"];

  test("keeps input order for an empty query", () => {
    expect(rankFuzzy(names, "", (n) => [n]).map((r) => r.item)).toEqual(names);
  });

  test("drops non-matches and ranks tighter matches first", () => {
    expect(rankFuzzy(names, "mob", (n) => [n]).map((r) => r.item)).toEqual([
      "mobile-common",
      "mobile-wallet",
      "mobile-banking",
    ]);
    expect(rankFuzzy(names, "mbank", (n) => [n]).map((r) => r.item)).toEqual(["mobile-banking"]);
    expect(rankFuzzy(names, "dep", (n) => [n])[0]?.item).toBe("deployd");
  });

  test("an exact prefix outranks a scattered match", () => {
    const ranked = rankFuzzy(["xa-xb-xc", "abc"], "abc", (n) => [n]);
    expect(ranked.map((r) => r.item)).toEqual(["abc", "xa-xb-xc"]);
  });

  test("matches any of an item's keys and reports which one matched best", () => {
    const items = [
      { id: "mb", name: "Mobile Banking" },
      { id: "ws", name: "Wallet Service" },
    ];
    const ranked = rankFuzzy(items, "ws", (w) => [w.name, w.id]);
    expect(ranked.map((r) => [r.item.id, r.key])).toEqual([["ws", 1]]);
  });
});
