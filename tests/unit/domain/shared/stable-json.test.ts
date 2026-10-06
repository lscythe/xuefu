import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import { stableStringify } from "../../../../src/domain/shared/stable-json";

describe("stableStringify", () => {
  test("sorts object keys recursively and preserves array order", () => {
    expect(stableStringify({ b: 1, a: { d: [3, 1], c: null } })).toBe(
      '{"a":{"c":null,"d":[3,1]},"b":1}',
    );
  });

  test("omits undefined object members like JSON.stringify", () => {
    expect(stableStringify({ a: undefined, b: 1 })).toBe('{"b":1}');
  });

  test("property: output does not depend on key insertion order", () => {
    fc.assert(
      fc.property(fc.dictionary(fc.string(), fc.jsonValue()), (obj) => {
        const reversed = Object.fromEntries(Object.entries(obj).reverse());
        expect(stableStringify(reversed)).toBe(stableStringify(obj));
      }),
    );
  });

  test("property: output parses back to an equal value", () => {
    fc.assert(
      fc.property(fc.jsonValue(), (value) => {
        expect(JSON.parse(stableStringify(value))).toEqual(JSON.parse(JSON.stringify(value)));
      }),
    );
  });
});
