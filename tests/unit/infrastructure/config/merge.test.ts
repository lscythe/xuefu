import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import { mergeLayers } from "../../../../src/infrastructure/config/merge";

type Tree = { [key: string]: Tree | number | string | boolean | number[] };

const key = fc.constantFrom("a", "b", "c", "logging", "level", "ui");
const leaf = fc.oneof(fc.integer(), fc.string({ maxLength: 4 }), fc.boolean(), fc.array(fc.nat()));
const { tree } = fc.letrec<{ tree: Tree }>((tie) => ({
  tree: fc.dictionary(key, fc.oneof({ depthSize: "small" }, leaf, tie("tree")), { maxKeys: 4 }),
}));

describe("mergeLayers", () => {
  test("merges nested objects, later layers win on leaves", () => {
    const merged = mergeLayers([
      { logging: { level: "info", maxFiles: 3 }, ui: { icons: "unicode" } },
      { logging: { level: "debug" } },
      { ui: { icons: "ascii" } },
    ]);
    expect(merged).toEqual({ logging: { level: "debug", maxFiles: 3 }, ui: { icons: "ascii" } });
  });

  test("arrays are replaced, not concatenated", () => {
    expect(mergeLayers([{ list: [1, 2, 3] }, { list: [4] }])).toEqual({ list: [4] });
  });

  test("a scalar can replace an object and vice versa", () => {
    expect(mergeLayers([{ a: { b: 1 } }, { a: 2 }])).toEqual({ a: 2 });
    expect(mergeLayers([{ a: 2 }, { a: { b: 1 } }])).toEqual({ a: { b: 1 } });
  });

  test("undefined values in a higher layer do not erase lower values", () => {
    expect(mergeLayers([{ a: 1 }, { a: undefined }])).toEqual({ a: 1 });
  });

  test("never copies prototype-polluting keys", () => {
    const hostile = JSON.parse('{"__proto__": {"polluted": true}, "constructor": {"x": 1}}');
    const merged = mergeLayers([{}, hostile]) as Record<string, unknown>;
    expect(({} as Record<string, unknown>)["polluted"]).toBeUndefined();
    expect(Object.keys(merged)).toEqual([]);
  });

  test("does not mutate its inputs", () => {
    const base = { logging: { level: "info" } };
    mergeLayers([base, { logging: { level: "debug" } }]);
    expect(base).toEqual({ logging: { level: "info" } });
  });

  test("property: empty layers are identities", () => {
    fc.assert(
      fc.property(tree, (a) => {
        expect(mergeLayers([{}, a])).toEqual(a);
        expect(mergeLayers([a, {}])).toEqual(a);
      }),
    );
  });

  test("a scalar in a middle layer resets the key for lower layers", () => {
    // Merging is a left fold, not an associative operation: grouping would change this result.
    expect(mergeLayers([{ logging: { a: "" } }, { logging: false }, { logging: {} }])).toEqual({
      logging: {},
    });
  });

  test("property: n-ary merge equals the left fold of pairwise merges", () => {
    fc.assert(
      fc.property(fc.array(tree, { maxLength: 5 }), (layers) => {
        const folded = layers.reduce<Tree>((acc, layer) => mergeLayers([acc, layer]) as Tree, {});
        expect(mergeLayers(layers)).toEqual(folded);
      }),
    );
  });

  test("property: merging is idempotent", () => {
    fc.assert(fc.property(tree, (a) => expect(mergeLayers([a, a])).toEqual(a)));
  });

  test("property: every leaf of the highest layer survives", () => {
    const leaves = (t: Tree, prefix: string[] = []): [string[], unknown][] =>
      Object.entries(t).flatMap(([k, v]) =>
        typeof v === "object" && !Array.isArray(v) && Object.keys(v).length > 0
          ? leaves(v, [...prefix, k])
          : [[[...prefix, k], v] as [string[], unknown]],
      );
    const get = (t: unknown, path: string[]) =>
      path.reduce<unknown>((node, k) => (node as Record<string, unknown>)?.[k], t);
    fc.assert(
      fc.property(tree, tree, (a, b) => {
        const merged = mergeLayers([a, b]);
        for (const [path, value] of leaves(b)) {
          if (typeof value === "object" && !Array.isArray(value)) continue; // empty object leaf
          expect(get(merged, path)).toEqual(value);
        }
      }),
    );
  });
});
