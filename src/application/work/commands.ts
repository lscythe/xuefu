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
import { issueKey } from "../../domain/work/issue-key";
import {
  finishWork,
  type IssueTitle,
  issueTitle,
  retitleWork,
  startWork,
  type WorkContext,
} from "../../domain/work/work-context";
import { findWorkspace } from "../../domain/workspace/registry";
import { type CommandContext, defineCommand } from "../commands/command";
import type { CommandBus } from "../commands/command-bus";
import type { Transaction, UnitOfWork } from "../ports/unit-of-work";
import type { WorkContextRepository } from "../ports/work-context-repository";
import type { TimerView } from "../timesheet/queries";
import {
  type StartedTimer,
  type TimerOperationDependencies,
  timerOperations,
} from "../timesheet/timer-operations";
import { domainString } from "../validation";
import type { WorkStartedPayload, WorkStoppedPayload } from "./events";
import { viewWork, type WorkView } from "./queries";

export interface WorkCommandDependencies extends TimerOperationDependencies {
  readonly contexts: WorkContextRepository;
  readonly unitOfWork: UnitOfWork;
}

export interface StartedWork {
  readonly work: WorkView;
  /** What the workspace was being worked on before, now finished. */
  readonly finished: WorkContext | null;
  /** The timer started or resumed for the work; null when it was already running. */
  readonly timer: StartedTimer | null;
}

export interface FinishedWork {
  readonly work: WorkView;
  /** The work's timer, now stopped; null when its timer was not running or paused. */
  readonly timer: TimerView | null;
}

type WorkError = NotFoundError | ConflictError | StorageError;

const CATEGORY = "Work";

/**
 * Work contexts' write side. Starting work also times it, and finishing work stops its timer, in
 * the same transaction, so the two never disagree.
 */
export function workCommands(deps: WorkCommandDependencies) {
  const { contexts, timers, workspaces, unitOfWork, ids } = deps;
  const timer = timerOperations(deps);

  const record = <T extends string, P extends object>(
    tx: Transaction,
    context: CommandContext,
    type: T,
    workspace: WorkspaceId,
    payload: P,
  ) => {
    tx.record(
      createEvent({
        id: ids.eventId(),
        type,
        version: 1,
        occurredAt: context.clock.now(),
        workspaceId: workspace,
        correlationId: context.correlationId,
        payload,
      }),
    );
  };

  const start = defineCommand({
    name: "work.start",
    title: "Start work",
    category: CATEGORY,
    safety: "safe",
    input: z.strictObject({
      workspace: domainString(workspaceId),
      issue: domainString(issueKey),
      title: domainString(issueTitle).optional(),
    }),
    handler: (input, context) =>
      unitOfWork.run((tx): Result<StartedWork, WorkError> => {
        const loaded = workspaces.load();
        if (!loaded.ok) return loaded;
        const found = findWorkspace(loaded.value, input.workspace);
        if (!found.ok) return found;
        const open = contexts.open();
        if (!open.ok) return open;
        const current = open.value.get(input.workspace) ?? null;
        const title: IssueTitle | null = input.title ?? null;
        const now = context.clock.now();

        let finished: WorkContext | null = null;
        let work: WorkContext;
        if (current !== null && current.issueKey === input.issue) {
          work = retitleWork(current, title);
        } else {
          if (current !== null) {
            const ended = finishWork(current, now);
            if (!ended.ok) return ended;
            const saved = contexts.save(ended.value);
            if (!saved.ok) return saved;
            record<"WorkStopped", WorkStoppedPayload>(tx, context, "WorkStopped", input.workspace, {
              workId: current.id,
              issueKey: current.issueKey,
            });
            finished = ended.value;
          }
          work = startWork(
            { id: ids.workId(), workspaceId: input.workspace, issueKey: input.issue, title },
            now,
          );
          record<"WorkStarted", WorkStartedPayload>(tx, context, "WorkStarted", input.workspace, {
            workId: work.id,
            workspaceId: input.workspace,
            issueKey: input.issue,
            title,
          });
        }
        if (work !== current) {
          const saved = contexts.save(work);
          if (!saved.ok) return saved;
        }

        const active = timers.active();
        if (!active.ok) return active;
        const timing =
          active.value?.status === "running" &&
          active.value.workspaceId === input.workspace &&
          active.value.issueKey === input.issue;
        if (timing && work === current) {
          return err(
            conflict(`Already working on ${input.issue} in ${found.value.name}`, "work", work.id),
          );
        }
        let started: StartedTimer | null = null;
        if (!timing) {
          const timed = timer.start(tx, context, input.workspace, input.issue);
          if (!timed.ok) return timed;
          started = timed.value;
        }
        return ok({ work: viewWork(loaded.value, work), finished, timer: started });
      }),
  });

  const finish = defineCommand({
    name: "work.finish",
    title: "Finish work",
    category: CATEGORY,
    safety: "safe",
    input: z.strictObject({ workspace: domainString(workspaceId) }),
    handler: (input, context) =>
      unitOfWork.run((tx): Result<FinishedWork, WorkError> => {
        const loaded = workspaces.load();
        if (!loaded.ok) return loaded;
        const open = contexts.open();
        if (!open.ok) return open;
        const current = open.value.get(input.workspace);
        if (current === undefined) {
          const found = findWorkspace(loaded.value, input.workspace);
          if (!found.ok) return found;
          return err(
            Object.freeze({
              ...notFound("work", input.workspace),
              message: `No work in progress in ${found.value.name}`,
            }),
          );
        }
        const ended = finishWork(current, context.clock.now());
        if (!ended.ok) return ended;
        const saved = contexts.save(ended.value);
        if (!saved.ok) return saved;
        record<"WorkStopped", WorkStoppedPayload>(tx, context, "WorkStopped", input.workspace, {
          workId: current.id,
          issueKey: current.issueKey,
        });

        const active = timers.active();
        if (!active.ok) return active;
        const own =
          active.value !== null &&
          active.value.workspaceId === current.workspaceId &&
          active.value.issueKey === current.issueKey;
        if (!own) return ok({ work: viewWork(loaded.value, ended.value), timer: null });
        const stopped = timer.changeActive((t) => timer.stop(tx, context, t));
        return stopped.ok
          ? ok({ work: viewWork(loaded.value, ended.value), timer: stopped.value })
          : stopped;
      }),
  });

  return { start, finish } as const;
}

export type WorkCommands = ReturnType<typeof workCommands>;

export function registerWorkCommands(
  bus: CommandBus,
  commands: WorkCommands,
): Result<void, DuplicateCommandError | ValidationError> {
  const start = bus.register(commands.start);
  if (!start.ok) return start;
  return bus.register(commands.finish);
}
