import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import {
  addDuration,
  type Duration,
  duration,
  durationBetween,
  sumDurations,
  timestamp,
} from "../../../../src/domain/shared/time";

const unwrap = <T>(r: { ok: true; value: T } | { ok: false }): T => {
  if (!r.ok) throw new Error("expected ok");
  return r.value;
};

describe("Timestamp", () => {
  test("accepts non-negative integer epoch milliseconds", () => {
    expect(timestamp(0).ok).toBe(true);
    expect(timestamp(1_760_000_000_000).ok).toBe(true);
  });

  test.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 2])(
    "rejects %p",
    (value) => {
      const result = timestamp(value);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.kind).toBe("validation");
    },
  );
});

describe("Duration", () => {
  test("rejects negative durations", () => {
    expect(duration(-1).ok).toBe(false);
  });

  test("durationBetween fails when end precedes start", () => {
    const start = unwrap(timestamp(2_000));
    const end = unwrap(timestamp(1_000));
    const result = durationBetween(start, end);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.context).toEqual({ start: 2000, end: 1000 });
  });

  test("durationBetween measures elapsed milliseconds", () => {
    expect(durationBetween(unwrap(timestamp(1_000)), unwrap(timestamp(4_500)))).toEqual({
      ok: true,
      value: 3_500 as Duration,
    });
  });

  test("addDuration moves a timestamp forward", () => {
    expect(addDuration(unwrap(timestamp(10)), unwrap(duration(5)))).toBe(unwrap(timestamp(15)));
  });

  test("invariant: a sum of durations is never negative", () => {
    fc.assert(
      fc.property(fc.array(fc.nat({ max: 86_400_000 }), { maxLength: 500 }), (values) => {
        const durations = values.map((v) => unwrap(duration(v)));
        const total = sumDurations(durations);
        expect(total).toBeGreaterThanOrEqual(0);
        expect<number>(total).toBe(values.reduce((a, b) => a + b, 0));
      }),
    );
  });

  test("property: durationBetween succeeds exactly when end >= start", () => {
    fc.assert(
      fc.property(fc.nat(), fc.nat(), (a, b) => {
        const result = durationBetween(unwrap(timestamp(a)), unwrap(timestamp(b)));
        expect(result.ok).toBe(b >= a);
        if (result.ok) expect<number>(result.value).toBe(b - a);
      }),
    );
  });
});
