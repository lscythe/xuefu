import { z } from "zod";
import type { DuplicateCommandError, ValidationError } from "../../domain/shared/errors";
import { workspaceId } from "../../domain/shared/ids";
import { ok, type Result } from "../../domain/shared/result";
import { timerToggle } from "../../domain/timesheet/timer";
import { issueKey } from "../../domain/work/issue-key";
import { defineCommand } from "../commands/command";
import type { CommandBus } from "../commands/command-bus";
import type { UnitOfWork } from "../ports/unit-of-work";
import { domainString } from "../validation";
import type { TimerView } from "./queries";
import {
  type TimerError,
  type TimerOperationDependencies,
  timerOperations,
} from "./timer-operations";

export interface TimerCommandDependencies extends TimerOperationDependencies {
  readonly unitOfWork: UnitOfWork;
}

const CATEGORY = "Timer";

/** The timer's write side. Starting one stops any other, so only one ever runs. */
export function timerCommands(deps: TimerCommandDependencies) {
  const { timers, unitOfWork } = deps;
  const {
    start: startIn,
    pause: pauseIn,
    resume: resumeIn,
    stop: stopIn,
    changeActive,
  } = timerOperations(deps);

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
    input: z.strictObject({
      workspace: domainString(workspaceId).nullable(),
      /** The issue a newly started timer is for, e.g. the work in progress there. */
      issue: domainString(issueKey).optional(),
    }),
    handler: (input, context) =>
      unitOfWork.run((tx): Result<TimerView | null, TimerError> => {
        const active = timers.active();
        if (!active.ok) return active;
        const action = timerToggle(active.value, input.workspace);
        if (action === "pause") return changeActive((timer) => pauseIn(tx, context, timer));
        if (action === "resume") return changeActive((timer) => resumeIn(tx, context, timer));
        if (action === null || input.workspace === null) return ok(null);
        const started = startIn(tx, context, input.workspace, input.issue ?? null);
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
