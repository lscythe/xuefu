import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import type { TimerId, WorkspaceId } from "../../../../src/domain/shared/ids";
import type { Result } from "../../../../src/domain/shared/result";
import type { Timestamp } from "../../../../src/domain/shared/time";
import {
  elapsed,
  pauseTimer,
  restoreTimer,
  resumeTimer,
  startTimer,
  stopTimer,
  type Timer,
  type TimerSegment,
  timerToggle,
} from "../../../../src/domain/timesheet/timer";
import type { IssueKey } from "../../../../src/domain/work/issue-key";

const at = (seconds: number) => (1_760_000_000_000 + seconds * 1000) as Timestamp;
const unwrap = <T>(result: Result<T, unknown>): T => {
  if (!result.ok) throw new Error("expected ok");
  return result.value;
};
const fresh = (seconds = 0, workspace = "mobile-banking") =>
  startTimer(
    {
      id: "t1" as TimerId,
      workspaceId: workspace as WorkspaceId,
      issueKey: "MOB-2841" as IssueKey,
    },
    at(seconds),
  );

describe("timer state machine", () => {
  test("start, pause, resume and stop keep every stretch of time", () => {
    const started = fresh(0);
    expect(started).toMatchObject({ status: "running", startedAt: at(0), updatedAt: at(0) });
    expect<number>(elapsed(started, at(90))).toBe(90_000);

    const paused = unwrap(pauseTimer(started, at(60)));
    expect(paused).toMatchObject({ status: "paused", updatedAt: at(60) });
    expect<number>(elapsed(paused, at(600))).toBe(60_000);

    const resumed = unwrap(resumeTimer(paused, at(120)));
    expect(resumed.status).toBe("running");
    expect<number>(elapsed(resumed, at(130))).toBe(70_000);

    const stopped = unwrap(stopTimer(resumed, at(150)));
    expect(stopped).toMatchObject({ status: "stopped", updatedAt: at(150) });
    expect(stopped.segments).toEqual([
      { start: at(0), end: at(60) },
      { start: at(120), end: at(150) },
    ]);
    expect<number>(elapsed(stopped, at(9999))).toBe(90_000);
  });

  test("a paused timer can stop without resuming", () => {
    const stopped = unwrap(stopTimer(unwrap(pauseTimer(fresh(), at(5))), at(50)));
    expect<number>(elapsed(stopped, at(60))).toBe(5000);
  });

  test("transitions that do not apply are conflicts", () => {
    const running = fresh();
    const paused = unwrap(pauseTimer(running, at(1)));
    const stopped = unwrap(stopTimer(running, at(1)));
    expect(resumeTimer(running, at(2))).toMatchObject({
      ok: false,
      error: {
        kind: "conflict",
        entity: "timer",
        key: "t1",
        message: "The timer is running, not paused",
      },
    });
    expect(pauseTimer(paused, at(2))).toMatchObject({
      ok: false,
      error: { message: "The timer is paused, not running" },
    });
    expect(pauseTimer(stopped, at(2)).ok).toBe(false);
    expect(resumeTimer(stopped, at(2)).ok).toBe(false);
    expect(stopTimer(stopped, at(2))).toMatchObject({
      ok: false,
      error: { message: "The timer has already stopped" },
    });
  });

  test("a clock that moves backwards never produces negative time", () => {
    const running = fresh(100);
    expect<number>(elapsed(running, at(40))).toBe(0);
    const paused = unwrap(pauseTimer(running, at(40)));
    expect(paused.segments).toEqual([{ start: at(100), end: at(100) }]);
    expect(paused.updatedAt).toBe(at(100));
    const resumed = unwrap(resumeTimer(paused, at(10)));
    expect(resumed.segments.at(-1)).toEqual({ start: at(100), end: null });
  });

  test("timers are frozen", () => {
    const timer = fresh();
    expect(Object.isFrozen(timer)).toBe(true);
    expect(Object.isFrozen(timer.segments)).toBe(true);
    expect(Object.isFrozen(timer.segments[0])).toBe(true);
  });

  test("property: any sequence of operations keeps the invariants", () => {
    const operation = fc.record({
      kind: fc.constantFrom("pause", "resume", "stop"),
      seconds: fc.integer({ min: -1000, max: 100_000 }),
    });
    fc.assert(
      fc.property(
        fc.array(operation, { maxLength: 30 }),
        fc.integer({ min: 0, max: 200_000 }),
        (ops, now) => {
          let timer: Timer = fresh(1000);
          for (const op of ops) {
            const apply =
              op.kind === "pause" ? pauseTimer : op.kind === "resume" ? resumeTimer : stopTimer;
            const next = apply(timer, at(1000 + op.seconds));
            if (next.ok) timer = next.value;
          }
          expect(restoreTimer(timer).ok).toBe(true);
          const total = elapsed(timer, at(now));
          expect(total).toBeGreaterThanOrEqual(0);
          expect<number>(elapsed(timer, at(now + 1))).toBeGreaterThanOrEqual(total);
          if (timer.status !== "running") expect<number>(elapsed(timer, at(now + 1))).toBe(total);
        },
      ),
    );
  });
});

describe("timerToggle", () => {
  const running = fresh(0, "a");
  const paused = unwrap(pauseTimer(running, at(1)));
  const here = "a" as WorkspaceId;
  const elsewhere = "b" as WorkspaceId;

  test("pauses or resumes this workspace's timer", () => {
    expect(timerToggle(running, here)).toBe("pause");
    expect(timerToggle(paused, here)).toBe("resume");
  });

  test("with no workspace in front, the active timer still pauses and resumes", () => {
    expect(timerToggle(running, null)).toBe("pause");
    expect(timerToggle(paused, null)).toBe("resume");
    expect(timerToggle(null, null)).toBeNull();
  });

  test("starts a timer for a workspace that has none running", () => {
    expect(timerToggle(null, here)).toBe("start");
    expect(timerToggle(running, elsewhere)).toBe("start");
  });
});

describe("restoreTimer", () => {
  const base = unwrap(stopTimer(fresh(0), at(10)));
  const segment = (start: number, end: number | null): TimerSegment => ({
    start: at(start),
    end: end === null ? null : at(end),
  });

  test("accepts timers the state machine produced", () => {
    expect(restoreTimer(base)).toEqual({ ok: true, value: base });
    expect(restoreTimer(fresh()).ok).toBe(true);
  });

  test.each([
    ["has no segments", { segments: [] }],
    ["first segment does not begin when the timer started", { segments: [segment(5, 10)] }],
    ["an earlier segment is open", { segments: [segment(0, null), segment(20, 30)] }],
    ["a segment ends before it starts", { segments: [segment(0, -1)] }],
    ["segments overlap", { segments: [segment(0, 10), segment(5, 20)] }],
    ["only a running timer has an open segment", { segments: [segment(0, null)] }],
    ["only a running timer has an open segment", { status: "running" as const }],
  ])("refuses a timer whose %s", (problem, change) => {
    expect(restoreTimer({ ...base, ...change })).toMatchObject({
      ok: false,
      error: { kind: "validation", issues: [{ message: problem }], context: { id: "t1" } },
    });
  });
});
