import {
  type ConflictError,
  conflict,
  type ValidationError,
  validationError,
} from "../shared/errors";
import type { TimerId, WorkspaceId } from "../shared/ids";
import { err, ok, type Result } from "../shared/result";
import { type Duration, sumDurations, type Timestamp } from "../shared/time";
import type { IssueKey } from "../work/issue-key";

/** Idle is the absence of an active timer; stopped is final. */
type TimerStatus = "running" | "paused" | "stopped";

/** One stretch of tracked time. Only the last segment of a running timer is open. */
export interface TimerSegment {
  readonly start: Timestamp;
  readonly end: Timestamp | null;
}

/**
 * Time tracked against a workspace and optionally an issue. Segments are stored rather than a
 * counter, so elapsed time is recomputed from them and survives crashes and restarts.
 */
export interface Timer {
  readonly id: TimerId;
  readonly workspaceId: WorkspaceId;
  readonly issueKey: IssueKey | null;
  readonly status: TimerStatus;
  readonly startedAt: Timestamp;
  readonly updatedAt: Timestamp;
  /** In order, never overlapping, never negative. */
  readonly segments: readonly TimerSegment[];
}

export interface NewTimer {
  readonly id: TimerId;
  readonly workspaceId: WorkspaceId;
  readonly issueKey: IssueKey | null;
}

const latest = (a: Timestamp, b: Timestamp): Timestamp => (b > a ? b : a);

function timerOf(timer: Timer): Timer {
  return Object.freeze({
    ...timer,
    segments: Object.freeze(timer.segments.map((segment) => Object.freeze({ ...segment }))),
  });
}

function wrongState(timer: Timer, message: string): ConflictError {
  return conflict(message, "timer", timer.id);
}

export function startTimer(fields: NewTimer, at: Timestamp): Timer {
  return timerOf({
    ...fields,
    status: "running",
    startedAt: at,
    updatedAt: at,
    segments: [{ start: at, end: null }],
  });
}

/**
 * Closes the open segment. A clock that moved backwards closes it where it began instead of
 * recording negative time.
 */
function closeOpenSegment(timer: Timer, at: Timestamp): readonly TimerSegment[] {
  return timer.segments.map((segment) =>
    segment.end === null ? { start: segment.start, end: latest(segment.start, at) } : segment,
  );
}

export function pauseTimer(timer: Timer, at: Timestamp): Result<Timer, ConflictError> {
  if (timer.status !== "running") {
    return err(wrongState(timer, `The timer is ${timer.status}, not running`));
  }
  return ok(
    timerOf({
      ...timer,
      status: "paused",
      updatedAt: latest(timer.updatedAt, at),
      segments: closeOpenSegment(timer, at),
    }),
  );
}

export function resumeTimer(timer: Timer, at: Timestamp): Result<Timer, ConflictError> {
  if (timer.status !== "paused") {
    return err(wrongState(timer, `The timer is ${timer.status}, not paused`));
  }
  // Never before the previous segment ended, so segments stay ordered if the clock jumps back.
  const start = timer.segments.reduce(
    (earliest, segment) => latest(earliest, segment.end ?? earliest),
    at,
  );
  return ok(
    timerOf({
      ...timer,
      status: "running",
      updatedAt: latest(timer.updatedAt, at),
      segments: [...timer.segments, { start, end: null }],
    }),
  );
}

export function stopTimer(timer: Timer, at: Timestamp): Result<Timer, ConflictError> {
  if (timer.status === "stopped") return err(wrongState(timer, "The timer has already stopped"));
  return ok(
    timerOf({
      ...timer,
      status: "stopped",
      updatedAt: latest(timer.updatedAt, at),
      segments: closeOpenSegment(timer, at),
    }),
  );
}

/** Tracked time as of `now`; an open segment counts up to `now` but never below zero. */
export function elapsed(timer: Timer, now: Timestamp): Duration {
  return sumDurations(
    timer.segments.map((segment) => {
      const end = segment.end ?? latest(segment.start, now);
      return (end - segment.start) as Duration;
    }),
  );
}

/** What the timer key does for `workspace`, the one in front (null when none is open). */
export type TimerToggle = "start" | "pause" | "resume";

/**
 * The active timer pauses or resumes when it belongs to the workspace in front, or when no
 * workspace is; any other workspace starts its own timer, which replaces the active one.
 */
export function timerToggle(
  active: Timer | null,
  workspace: WorkspaceId | null,
): TimerToggle | null {
  if (active !== null && (workspace === null || active.workspaceId === workspace)) {
    return active.status === "running" ? "pause" : "resume";
  }
  return workspace === null ? null : "start";
}

function invalid(problem: string, id: string): ValidationError {
  return validationError("Stored timer is inconsistent", [{ path: "timer", message: problem }], {
    id,
  });
}

/** Rebuilds a stored timer, refusing data that breaks the timer's invariants. */
export function restoreTimer(timer: Timer): Result<Timer, ValidationError> {
  const { segments } = timer;
  if (segments.length === 0) return err(invalid("has no segments", timer.id));
  const first = segments[0];
  if (first !== undefined && first.start !== timer.startedAt) {
    return err(invalid("first segment does not begin when the timer started", timer.id));
  }
  let previousEnd: Timestamp | null = null;
  for (const [index, segment] of segments.entries()) {
    const last = index === segments.length - 1;
    if (segment.end === null && !last) return err(invalid("an earlier segment is open", timer.id));
    if (segment.end !== null && segment.end < segment.start) {
      return err(invalid("a segment ends before it starts", timer.id));
    }
    if (previousEnd !== null && segment.start < previousEnd) {
      return err(invalid("segments overlap", timer.id));
    }
    previousEnd = segment.end;
  }
  const open = segments.at(-1)?.end === null;
  if (open !== (timer.status === "running")) {
    return err(invalid("only a running timer has an open segment", timer.id));
  }
  return ok(timerOf(timer));
}
