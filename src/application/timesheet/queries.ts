import type { CalendarDay } from "../../domain/shared/calendar";
import type { StorageError } from "../../domain/shared/errors";
import type { EntryId, TimerId } from "../../domain/shared/ids";
import { ok, type Result } from "../../domain/shared/result";
import type { Timestamp } from "../../domain/shared/time";
import type { TimesheetDay } from "../../domain/timesheet/day";
import type { TimeEntry } from "../../domain/timesheet/entry";
import type { Timer, TimerSegment } from "../../domain/timesheet/timer";
import { entrySpan, type TrackedSpan } from "../../domain/timesheet/tracked";
import type { WorkspaceRegistry } from "../../domain/workspace/registry";
import type { Workspace } from "../../domain/workspace/workspace";
import type { TimerRepository } from "../ports/timer-repository";
import type { TimesheetRepository } from "../ports/timesheet-repository";
import type { WorkspaceRepository } from "../ports/workspace-repository";

/** A timer with the workspace it tracks; null once that workspace has been removed. */
export interface TimerView {
  readonly timer: Timer;
  readonly workspace: Workspace | null;
}

/** Tracked time, timers' and entries', with the workspaces it was tracked in by id. */
export interface TrackedTime {
  readonly spans: readonly TrackedSpan[];
  /** Removed workspaces are missing; their time is still counted. */
  readonly workspaces: ReadonlyMap<string, Workspace>;
}

export function viewTimer(registry: WorkspaceRegistry, timer: Timer): TimerView {
  return {
    timer,
    workspace: registry.workspaces.find((w) => w.id === timer.workspaceId) ?? null,
  };
}

export class TimerQueries {
  constructor(
    private readonly timers: TimerRepository,
    private readonly timesheet: TimesheetRepository,
    private readonly workspaces: WorkspaceRepository,
  ) {}

  /** The running or paused timer, if there is one. */
  active(): Result<TimerView | null, StorageError> {
    const active = this.timers.active();
    if (!active.ok) return active;
    if (active.value === null) return ok(null);
    const loaded = this.workspaces.load();
    return loaded.ok ? ok(viewTimer(loaded.value, active.value)) : loaded;
  }

  /** Every stretch of time tracked from `from` until `to`, timed or added, oldest first. */
  tracked(from: Timestamp, to: Timestamp): Result<TrackedTime, StorageError> {
    const timed = this.timers.tracked(from, to);
    if (!timed.ok) return timed;
    const added = this.timesheet.entries(from, to);
    if (!added.ok) return added;
    const loaded = this.workspaces.load();
    if (!loaded.ok) return loaded;
    return ok({
      spans: [...timed.value, ...added.value.map(entrySpan)].sort((a, b) => a.start - b.start),
      workspaces: new Map(loaded.value.workspaces.map((w) => [w.id as string, w])),
    });
  }

  entry(id: EntryId): Result<TimeEntry | null, StorageError> {
    return this.timesheet.entry(id);
  }

  /** One stretch of a timer, by the timer's id and its place among them; null when there is none. */
  stretch(timer: TimerId, position: number): Result<TimerSegment | null, StorageError> {
    const found = this.timers.timer(timer);
    if (!found.ok) return found;
    return ok(found.value?.segments[position] ?? null);
  }

  /** What the timesheet says of the days from `from` to `to`, both included. */
  days(from: CalendarDay, to: CalendarDay): Result<TimesheetDay[], StorageError> {
    return this.timesheet.days(from, to);
  }
}
