import { z } from "zod";
import {
  type ConflictError,
  conflict,
  type DuplicateCommandError,
  type NotFoundError,
  notFound,
  type StorageError,
  type ValidationError,
} from "../../domain/shared/errors";
import { createEvent } from "../../domain/shared/event";
import { type WorkspaceId, workspaceId } from "../../domain/shared/ids";
import { err, ok, type Result } from "../../domain/shared/result";
import {
  elapsed,
  pauseTimer,
  resumeTimer,
  startTimer,
  stopTimer,
  type Timer,
  timerToggle,
} from "../../domain/timesheet/timer";
import { type IssueKey, issueKey } from "../../domain/work/issue-key";
import { findWorkspace, type WorkspaceRegistry } from "../../domain/workspace/registry";
import { type CommandContext, defineCommand } from "../commands/command";
import type { CommandBus } from "../commands/command-bus";
import type { IdGenerator } from "../ports/id-generator";
import type { TimerRepository } from "../ports/timer-repository";
import type { Transaction, UnitOfWork } from "../ports/unit-of-work";
import type { WorkspaceRepository } from "../ports/workspace-repository";
import { domainString } from "../validation";
import type {
  TimerPausedPayload,
  TimerResumedPayload,
  TimerStartedPayload,
  TimerStoppedPayload,
} from "./events";
import { type TimerView, viewTimer } from "./queries";

export interface TimerCommandDependencies {
  readonly timers: TimerRepository;
  readonly workspaces: WorkspaceRepository;
  readonly unitOfWork: UnitOfWork;
  readonly ids: IdGenerator;
}

/** The timer now running, and the one it stopped to get there, if any. */
export interface StartedTimer {
  readonly timer: TimerView;
  readonly replaced: TimerView | null;
}

type TimerError = NotFoundError | ConflictError | StorageError;

const CATEGORY = "Timer";

function noActiveTimer(): NotFoundError {
  return Object.freeze({ ...notFound("timer", "active"), message: "No timer is running" });
}

/** The timer's write side. Starting one stops any other, so only one ever runs. */
export function timerCommands(deps: TimerCommandDependencies) {
  const { timers, workspaces, unitOfWork, ids } = deps;

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

  const start = defineCommand({
    name: "timer.start",
    title: "Start timer",
    category: CATEGORY,
    safety: "safe",
    input: z.strictObject({
      workspace: domainString(workspaceId),
      issue: domainString(issueKey).optional(),
    }),
    handler: (input, context) =>
      unitOfWork.run((tx) => startIn(tx, context, input.workspace, input.issue ?? null)),
  });

  const pause = defineCommand({
    name: "timer.pause",
    title: "Pause timer",
    category: CATEGORY,
    safety: "safe",
    input: z.strictObject({}),
    handler: (_input, context) =>
      unitOfWork.run((tx) => changeActive((timer) => pauseIn(tx, context, timer))),
  });

  const resume = defineCommand({
    name: "timer.resume",
    title: "Resume timer",
    category: CATEGORY,
    safety: "safe",
    input: z.strictObject({}),
    handler: (_input, context) =>
      unitOfWork.run((tx) => changeActive((timer) => resumeIn(tx, context, timer))),
  });

  const stop = defineCommand({
    name: "timer.stop",
    title: "Stop timer",
    category: CATEGORY,
    safety: "safe",
    input: z.strictObject({}),
    handler: (_input, context) =>
      unitOfWork.run((tx) => changeActive((timer) => stopIn(tx, context, timer))),
  });

  /** The cockpit's timer key; see timerToggle. Resolves to null when there was nothing to do. */
  const toggle = defineCommand({
    name: "timer.toggle",
    title: "Start or pause timer",
    category: CATEGORY,
    safety: "safe",
    input: z.strictObject({ workspace: domainString(workspaceId).nullable() }),
    handler: (input, context) =>
      unitOfWork.run((tx): Result<TimerView | null, TimerError> => {
        const active = timers.active();
        if (!active.ok) return active;
        const action = timerToggle(active.value, input.workspace);
        if (action === "pause") return changeActive((timer) => pauseIn(tx, context, timer));
        if (action === "resume") return changeActive((timer) => resumeIn(tx, context, timer));
        if (action === null || input.workspace === null) return ok(null);
        const started = startIn(tx, context, input.workspace, null);
        return started.ok ? ok(started.value.timer) : started;
      }),
  });

  return { start, pause, resume, stop, toggle } as const;
}

export type TimerCommands = ReturnType<typeof timerCommands>;

export function registerTimerCommands(
  bus: CommandBus,
  commands: TimerCommands,
): Result<void, DuplicateCommandError | ValidationError> {
  const start = bus.register(commands.start);
  if (!start.ok) return start;
  const pause = bus.register(commands.pause);
  if (!pause.ok) return pause;
  const resume = bus.register(commands.resume);
  if (!resume.ok) return resume;
  const stop = bus.register(commands.stop);
  if (!stop.ok) return stop;
  return bus.register(commands.toggle);
}
