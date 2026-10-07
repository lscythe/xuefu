import {
  type ConflictError,
  conflict,
  type NotFoundError,
  notFound,
  type StorageError,
} from "../../domain/shared/errors";
import { createEvent } from "../../domain/shared/event";
import type { WorkspaceId } from "../../domain/shared/ids";
import { err, ok, type Result } from "../../domain/shared/result";
import {
  elapsed,
  pauseTimer,
  resumeTimer,
  startTimer,
  stopTimer,
  type Timer,
} from "../../domain/timesheet/timer";
import type { IssueKey } from "../../domain/work/issue-key";
import { findWorkspace, type WorkspaceRegistry } from "../../domain/workspace/registry";
import type { CommandContext } from "../commands/command";
import type { IdGenerator } from "../ports/id-generator";
import type { TimerRepository } from "../ports/timer-repository";
import type { Transaction } from "../ports/unit-of-work";
import type { WorkspaceRepository } from "../ports/workspace-repository";
import type {
  TimerPausedPayload,
  TimerResumedPayload,
  TimerStartedPayload,
  TimerStoppedPayload,
} from "./events";
import { type TimerView, viewTimer } from "./queries";

export interface TimerOperationDependencies {
  readonly timers: TimerRepository;
  readonly workspaces: WorkspaceRepository;
  readonly ids: IdGenerator;
}

/** The timer now running, and the one it stopped to get there, if any. */
export interface StartedTimer {
  readonly timer: TimerView;
  readonly replaced: TimerView | null;
}

export type TimerError = NotFoundError | ConflictError | StorageError;

function noActiveTimer(): NotFoundError {
  return Object.freeze({ ...notFound("timer", "active"), message: "No timer is running" });
}

/**
 * Timer changes that save the timer and record their event. They must run inside a unit of work,
 * which lets other commands (starting work, say) change the timer in the same transaction.
 */
export function timerOperations(deps: TimerOperationDependencies) {
  const { timers, workspaces, ids } = deps;

  const record = <T extends string, P extends object>(
    tx: Transaction,
    context: CommandContext,
    type: T,
    timer: Timer,
    payload: P,
  ) => {
    tx.record(
      createEvent({
        id: ids.eventId(),
        type,
        version: 1,
        occurredAt: context.clock.now(),
        workspaceId: timer.workspaceId,
        correlationId: context.correlationId,
        payload,
      }),
    );
  };

  /** Loads the registry and the active timer; must run inside a unit of work. */
  const load = (): Result<
    { readonly registry: WorkspaceRegistry; readonly active: Timer | null },
    StorageError
  > => {
    const registry = workspaces.load();
    if (!registry.ok) return registry;
    const active = timers.active();
    return active.ok ? ok({ registry: registry.value, active: active.value }) : active;
  };

  const save = (timer: Timer, registry: WorkspaceRegistry): Result<TimerView, StorageError> => {
    const saved = timers.save(timer);
    return saved.ok ? ok(viewTimer(registry, timer)) : saved;
  };

  const pauseIn = (tx: Transaction, context: CommandContext, timer: Timer) => {
    const paused = pauseTimer(timer, context.clock.now());
    if (!paused.ok) return paused;
    record<"TimerPaused", TimerPausedPayload>(tx, context, "TimerPaused", paused.value, {
      timerId: timer.id,
      elapsedMs: elapsed(paused.value, paused.value.updatedAt),
    });
    return ok(paused.value);
  };

  const resumeIn = (tx: Transaction, context: CommandContext, timer: Timer) => {
    const resumed = resumeTimer(timer, context.clock.now());
    if (!resumed.ok) return resumed;
    record<"TimerResumed", TimerResumedPayload>(tx, context, "TimerResumed", resumed.value, {
      timerId: timer.id,
    });
    return ok(resumed.value);
  };

  const stopIn = (tx: Transaction, context: CommandContext, timer: Timer) => {
    const stopped = stopTimer(timer, context.clock.now());
    if (!stopped.ok) return stopped;
    record<"TimerStopped", TimerStoppedPayload>(tx, context, "TimerStopped", stopped.value, {
      timerId: timer.id,
      elapsedMs: elapsed(stopped.value, stopped.value.updatedAt),
    });
    return ok(stopped.value);
  };

  /**
   * Starts a timer for the workspace. The same workspace and issue's paused timer resumes
   * instead; any other active timer is stopped first.
   */
  const startIn = (
    tx: Transaction,
    context: CommandContext,
    workspace: WorkspaceId,
    issue: IssueKey | null,
  ): Result<StartedTimer, TimerError> => {
    const loaded = load();
    if (!loaded.ok) return loaded;
    const { registry, active } = loaded.value;
    const found = findWorkspace(registry, workspace);
    if (!found.ok) return found;

    let replaced: TimerView | null = null;
    if (active !== null) {
      if (active.workspaceId === workspace && active.issueKey === issue) {
        if (active.status === "running") {
          return err(
            conflict(`A timer is already running for ${found.value.name}`, "timer", active.id),
          );
        }
        const resumed = resumeIn(tx, context, active);
        if (!resumed.ok) return resumed;
        const saved = save(resumed.value, registry);
        return saved.ok ? ok({ timer: saved.value, replaced: null }) : saved;
      }
      const stopped = stopIn(tx, context, active);
      if (!stopped.ok) return stopped;
      const saved = save(stopped.value, registry);
      if (!saved.ok) return saved;
      replaced = saved.value;
    }

    const started = startTimer(
      { id: ids.timerId(), workspaceId: workspace, issueKey: issue },
      context.clock.now(),
    );
    record<"TimerStarted", TimerStartedPayload>(tx, context, "TimerStarted", started, {
      timerId: started.id,
      workspaceId: workspace,
      issueKey: issue,
    });
    const saved = save(started, registry);
    return saved.ok ? ok({ timer: saved.value, replaced }) : saved;
  };

  /** Applies `change` to the active timer; must run inside a unit of work. */
  const changeActive = (
    change: (timer: Timer) => Result<Timer, ConflictError>,
  ): Result<TimerView, TimerError> => {
    const loaded = load();
    if (!loaded.ok) return loaded;
    const { registry, active } = loaded.value;
    if (active === null) return err(noActiveTimer());
    const changed = change(active);
    return changed.ok ? save(changed.value, registry) : changed;
  };

  return { start: startIn, pause: pauseIn, resume: resumeIn, stop: stopIn, changeActive } as const;
}
