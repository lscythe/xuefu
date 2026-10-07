import { describe, expect, test } from "bun:test";
import { correlationId, eventId, timerId, workId } from "../../../../src/domain/shared/ids";
import { systemClock } from "../../../../src/infrastructure/system/clock";
import { uuidV7Ids } from "../../../../src/infrastructure/system/ids";

describe("systemClock", () => {
  test("returns the current epoch milliseconds", () => {
    const before = Date.now();
    const now = systemClock.now();
    expect(now).toBeGreaterThanOrEqual(before);
    expect(now).toBeLessThanOrEqual(Date.now());
  });
});

describe("uuidV7Ids", () => {
  test("generates valid, unique, time-ordered event ids", () => {
    const ids = Array.from({ length: 50 }, () => uuidV7Ids.eventId());
    expect(new Set(ids).size).toBe(50);
    for (const id of ids) expect(eventId(id).ok).toBe(true);
    expect([...ids].sort()).toEqual(ids);
  });

  test("generates valid correlation, timer and work ids", () => {
    expect(correlationId(uuidV7Ids.correlationId()).ok).toBe(true);
    expect(timerId(uuidV7Ids.timerId()).ok).toBe(true);
    expect(workId(uuidV7Ids.workId()).ok).toBe(true);
  });
});
