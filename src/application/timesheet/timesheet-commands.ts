import { z } from "zod";
import { calendarDay } from "../../domain/shared/calendar";
import {
  type DuplicateCommandError,
  type NotFoundError,
  notFound,
  type StorageError,
  type ValidationError,
} from "../../domain/shared/errors";
import { createEvent } from "../../domain/shared/event";
import { entryId, timerId, type WorkspaceId, workspaceId } from "../../domain/shared/ids";
import { err, ok, type Result } from "../../domain/shared/result";
import { type Timestamp, timestamp } from "../../domain/shared/time";
import { dayTasks, emptyDay, type TimesheetDay, workPlace } from "../../domain/timesheet/day";
import { category, entryNote, type TimeEntry, timeEntry } from "../../domain/timesheet/entry";
import { moveSegment, type Timer } from "../../domain/timesheet/timer";
import { issueKey } from "../../domain/work/issue-key";
import { findWorkspace } from "../../domain/workspace/registry";
import { type CommandContext, defineCommand } from "../commands/command";
import type { CommandBus } from "../commands/command-bus";
import type { IdGenerator } from "../ports/id-generator";
import type { TimerRepository } from "../ports/timer-repository";
import type { TimesheetRepository } from "../ports/timesheet-repository";
import type { Transaction, UnitOfWork } from "../ports/unit-of-work";
import type { WorkspaceRepository } from "../ports/workspace-repository";
import { domainString } from "../validation";
import type {
  TimeEntryAddedPayload,
  TimeEntryChangedPayload,
  TimeEntryDeletedPayload,
  TimerSegmentMovedPayload,
  TimesheetDayChangedPayload,
} from "./events";

export interface TimesheetCommandDependencies {
  readonly timesheet: TimesheetRepository;
  readonly timers: TimerRepository;
  readonly workspaces: WorkspaceRepository;
  readonly unitOfWork: UnitOfWork;
  readonly ids: IdGenerator;
}

type TimesheetError = NotFoundError | ValidationError | StorageError;

const CATEGORY = "Timesheet";

const moment = z.number().transform((raw, ctx): Timestamp => {
  const parsed = timestamp(raw);
  if (parsed.ok) return parsed.value;
  ctx.addIssue({ code: "custom", message: "must be a moment in epoch milliseconds" });
  return z.NEVER;
});

/** Free text a domain rule reads, where blank means none. */
const optionalText = <T>(parse: (raw: string) => Result<T | null, ValidationError>) =>
  z
    .string()
    .max(10_000)
    .transform((raw, ctx): T | null => {
      const parsed = parse(raw);
      if (parsed.ok) return parsed.value;
      for (const issue of parsed.error.issues)
        ctx.addIssue({ code: "custom", message: issue.message });
      return z.NEVER;
    });

const noEntry = (id: string): NotFoundError =>
  Object.freeze({ ...notFound("time entry", id), message: `No time entry ${id}` });

/** Time added by hand, timers' time fixed, and what the timesheet says of a day. */
export function timesheetCommands(deps: TimesheetCommandDependencies) {
  const { timesheet, timers, workspaces, unitOfWork, ids } = deps;

  const record = <T extends string, P extends object>(
    tx: Transaction,
    context: CommandContext,
    type: T,
    workspace: WorkspaceId | null,
    payload: P,
  ) =>
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

  const known = (workspace: WorkspaceId): Result<void, TimesheetError> => {
    const loaded = workspaces.load();
    if (!loaded.ok) return loaded;
    const found = findWorkspace(loaded.value, workspace);
    return found.ok ? ok(undefined) : found;
  };

  const length = (entry: TimeEntry) => entry.end - entry.start;

  const add = defineCommand({
    name: "timesheet.entry.add",
    title: "Add time",
    category: CATEGORY,
    safety: "safe",
    input: z.strictObject({
      workspace: domainString(workspaceId),
      issue: domainString(issueKey).optional(),
      category: domainString(category).optional(),
      start: moment,
      end: moment,
      note: optionalText(entryNote).optional(),
    }),
    handler: (input, context) =>
      unitOfWork.run((tx): Result<TimeEntry, TimesheetError> => {
        const workspace = known(input.workspace);
        if (!workspace.ok) return workspace;
        const entry = timeEntry({
          id: ids.entryId(),
          workspaceId: input.workspace,
          issueKey: input.issue ?? null,
          category: input.category ?? null,
          start: input.start,
          end: input.end,
          note: input.note ?? null,
        });
        if (!entry.ok) return entry;
        const saved = timesheet.saveEntry(entry.value);
        if (!saved.ok) return saved;
        record<"TimeEntryAdded", TimeEntryAddedPayload>(
          tx,
          context,
          "TimeEntryAdded",
          entry.value.workspaceId,
          {
            entryId: entry.value.id,
            issueKey: entry.value.issueKey,
            category: entry.value.category,
            durationMs: length(entry.value),
          },
        );
        return ok(entry.value);
      }),
  });

  /** Changes what is given; an issue given takes the place of a category, and the other way. */
  const edit = defineCommand({
    name: "timesheet.entry.edit",
    title: "Change time",
    category: CATEGORY,
    safety: "safe",
    input: z.strictObject({
      id: domainString(entryId),
      issue: domainString(issueKey).optional(),
      category: domainString(category).optional(),
      start: moment.optional(),
      end: moment.optional(),
      note: optionalText(entryNote).optional(),
    }),
    handler: (input, context) =>
      unitOfWork.run((tx): Result<TimeEntry, TimesheetError> => {
        const found = timesheet.entry(input.id);
        if (!found.ok) return found;
        const current = found.value;
        if (current === null) return err(noEntry(input.id));
        const subject =
          input.issue !== undefined
            ? { issueKey: input.issue, category: null }
            : input.category !== undefined
              ? { issueKey: null, category: input.category }
              : {};
        const entry = timeEntry({
          ...current,
          ...subject,
          start: input.start ?? current.start,
          end: input.end ?? current.end,
          note: input.note === undefined ? current.note : input.note,
        });
        if (!entry.ok) return entry;
        const saved = timesheet.saveEntry(entry.value);
        if (!saved.ok) return saved;
        record<"TimeEntryChanged", TimeEntryChangedPayload>(
          tx,
          context,
          "TimeEntryChanged",
          entry.value.workspaceId,
          { entryId: entry.value.id, durationMs: length(entry.value) },
        );
        return ok(entry.value);
      }),
  });

  const remove = defineCommand({
    name: "timesheet.entry.delete",
    title: "Delete time",
    category: CATEGORY,
    safety: "confirm",
    input: z.strictObject({ id: domainString(entryId) }),
    describe: (input) => {
      const found = timesheet.entry(input.id);
      const entry = found.ok ? found.value : null;
      return {
        title: "Delete time",
        severity: "confirm",
        details: [
          { label: "Entry", value: input.id },
          ...(entry === null
            ? []
            : [
                { label: "On", value: entry.issueKey ?? entry.category ?? "" },
                { label: "Minutes", value: String(Math.round(length(entry) / 60_000)) },
              ]),
        ],
        consequence: "The time is taken off the timesheet. It cannot be brought back.",
        confirmLabel: "Delete",
      };
    },
    handler: (input, context) =>
      unitOfWork.run((tx): Result<TimeEntry, TimesheetError> => {
        const found = timesheet.entry(input.id);
        if (!found.ok) return found;
        if (found.value === null) return err(noEntry(input.id));
        const removed = timesheet.removeEntry(input.id);
        if (!removed.ok) return removed;
        record<"TimeEntryDeleted", TimeEntryDeletedPayload>(
          tx,
          context,
          "TimeEntryDeleted",
          found.value.workspaceId,
          { entryId: input.id, durationMs: length(found.value) },
        );
        return ok(found.value);
      }),
  });

  /** Fixes when a stretch of a timer started or ended, such as one left running overnight. */
  const moveTimer = defineCommand({
    name: "timesheet.timer.move",
    title: "Change timed time",
    category: CATEGORY,
    safety: "safe",
    input: z.strictObject({
      timer: domainString(timerId),
      position: z.number().int().nonnegative(),
      start: moment,
      end: moment.nullable(),
    }),
    handler: (input, context) =>
      unitOfWork.run((tx): Result<Timer, TimesheetError> => {
        const found = timers.timer(input.timer);
        if (!found.ok) return found;
        if (found.value === null) return err(notFound("timer", input.timer));
        const moved = moveSegment(
          found.value,
          input.position,
          { start: input.start, end: input.end },
          context.clock.now(),
        );
        if (!moved.ok) return moved;
        const saved = timers.save(moved.value);
        if (!saved.ok) return saved;
        record<"TimerSegmentMoved", TimerSegmentMovedPayload>(
          tx,
          context,
          "TimerSegmentMoved",
          moved.value.workspaceId,
          { timerId: input.timer, position: input.position },
        );
        return ok(moved.value);
      }),
  });

  /** Sets what is given of a day; blank text puts it back to none, or the usual place. */
  const setDay = defineCommand({
    name: "timesheet.day.set",
    title: "Change a day",
    category: CATEGORY,
    safety: "safe",
    input: z.strictObject({
      day: domainString(calendarDay),
      place: optionalText(workPlace).optional(),
      leave: z.boolean().optional(),
      tasks: optionalText(dayTasks).optional(),
    }),
    handler: (input, context) =>
      unitOfWork.run((tx): Result<TimesheetDay, TimesheetError> => {
        const found = timesheet.days(input.day, input.day);
        if (!found.ok) return found;
        const current = found.value[0] ?? emptyDay(input.day);
        const day: TimesheetDay = Object.freeze({
          day: input.day,
          place: input.place === undefined ? current.place : input.place,
          leave: input.leave ?? current.leave,
          tasks: input.tasks === undefined ? current.tasks : input.tasks,
        });
        const saved = timesheet.saveDay(day, context.clock.now());
        if (!saved.ok) return saved;
        record<"TimesheetDayChanged", TimesheetDayChangedPayload>(
          tx,
          context,
          "TimesheetDayChanged",
          null,
          { day: input.day, leave: day.leave, tasks: day.tasks !== null },
        );
        return ok(day);
      }),
  });

  return { add, edit, remove, moveTimer, setDay } as const;
}

export type TimesheetCommands = ReturnType<typeof timesheetCommands>;

export function registerTimesheetCommands(
  bus: CommandBus,
  commands: TimesheetCommands,
): Result<void, DuplicateCommandError | ValidationError> {
  const registrations = [
    () => bus.register(commands.add),
    () => bus.register(commands.edit),
    () => bus.register(commands.remove),
    () => bus.register(commands.moveTimer),
    () => bus.register(commands.setDay),
  ];
  for (const register of registrations) {
    const registered = register();
    if (!registered.ok) return registered;
  }
  return ok(undefined);
}
