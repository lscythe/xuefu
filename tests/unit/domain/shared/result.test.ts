import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import {
  all,
  andThen,
  err,
  fromThrowable,
  fromThrowableAsync,
  isErr,
  isOk,
  map,
  mapErr,
  match,
  ok,
  type Result,
  unwrapOr,
} from "../../../../src/domain/shared/result";

const toMessage = (e: unknown): string => (e instanceof Error ? e.message : String(e));

describe("Result", () => {
  test("ok and err construct discriminated values", () => {
    expect(ok(1)).toEqual({ ok: true, value: 1 });
    expect(err("boom")).toEqual({ ok: false, error: "boom" });
    expect(isOk(ok(1))).toBe(true);
    expect(isErr(err("x"))).toBe(true);
  });

  test("results are frozen", () => {
    expect(Object.isFrozen(ok(1))).toBe(true);
    expect(Object.isFrozen(err("x"))).toBe(true);
  });

  test("map transforms only success values", () => {
    expect(map(ok(2), (n) => n * 3)).toEqual(ok(6));
    expect(map(err<string>("e") as Result<number, string>, (n) => n * 3)).toEqual(err("e"));
  });

  test("mapErr transforms only errors", () => {
    expect(mapErr(err("e"), (e) => `${e}!`)).toEqual(err("e!"));
    expect(mapErr(ok(1) as Result<number, string>, (e) => `${e}!`)).toEqual(ok(1));
  });

  test("andThen short-circuits on the first error", () => {
    let calls = 0;
    const half = (n: number): Result<number, string> => {
      calls += 1;
      return n % 2 === 0 ? ok(n / 2) : err(`odd: ${n}`);
    };
    expect(andThen(andThen(ok(8), half), half)).toEqual(ok(2));
    calls = 0;
    expect(andThen(andThen(ok(3), half), half)).toEqual(err("odd: 3"));
    expect(calls).toBe(1);
  });

  test("unwrapOr returns the fallback only for errors", () => {
    expect(unwrapOr(ok(1), 0)).toBe(1);
    expect(unwrapOr(err("x") as Result<number, string>, 0)).toBe(0);
  });

  test("match dispatches to the right branch", () => {
    const describe = (r: Result<number, string>) =>
      match(r, {
        ok: (v) => `value ${v}`,
        err: (e) => `error ${e}`,
      });
    expect(describe(ok(1))).toBe("value 1");
    expect(describe(err("x"))).toBe("error x");
  });

  test("all collects values or returns the first error", () => {
    expect(all([ok(1), ok(2), ok(3)])).toEqual(ok([1, 2, 3]));
    expect(all([ok(1), err("a"), err("b")])).toEqual(err("a"));
    expect(all([])).toEqual(ok([]));
  });

  test("fromThrowable converts thrown exceptions into errors", () => {
    expect(fromThrowable(() => JSON.parse("{}"), toMessage)).toEqual(ok({}));
    const parsed = fromThrowable(() => JSON.parse("{"), toMessage);
    expect(parsed.ok).toBe(false);
  });

  test("fromThrowableAsync converts rejections into errors", async () => {
    expect(await fromThrowableAsync(async () => 1, toMessage)).toEqual(ok(1));
    expect(await fromThrowableAsync(() => Promise.reject(new Error("nope")), toMessage)).toEqual(
      err("nope"),
    );
  });

  test("property: map obeys identity and composition laws", () => {
    fc.assert(
      fc.property(fc.integer(), (n) => {
        const r = ok(n);
        expect(map(r, (x) => x)).toEqual(r);
        const f = (x: number) => x + 1;
        const g = (x: number) => x * 2;
        expect(map(map(r, f), g)).toEqual(map(r, (x) => g(f(x))));
      }),
    );
  });
});
