import { confirmationTokenFor } from "../application/commands/command";
import type { AppError } from "../application/errors";
import { dayJson, formatDay, formatDays } from "../cli/format-timesheet";
import type { CliCommand, TimeFields, TimesheetTarget } from "../cli/parse-args";
import { assertNever } from "../domain/shared/assert-never";
import {
  addDays,
  type CalendarDay,
  calendarDay,
  calendarMonth,
  dayOf,
  dayStart,
  daysOf,
  minutesOf,
  monthOf,
  weekStart,
} from "../domain/shared/calendar";
import { notFound, type ValidationError, validationError } from "../domain/shared/errors";
import { entryId, timerId, workspaceId } from "../domain/shared/ids";
import { err, ok, type Result } from "../domain/shared/result";
import type { Timestamp } from "../domain/shared/time";
import { groupScope, scopeName, scopeOf, type TimesheetScope } from "../domain/timesheet/scope";
import { daySheets } from "../domain/timesheet/sheet";
import { groupName, type Workspace } from "../domain/workspace/workspace";
import { systemClock } from "../infrastructure/system/clock";
import type { App } from "./start-app";

/** What the timesheet's commands need of the CLI around them. */
export interface TimesheetCli {
  readonly app: App;
  readonly fail: (error: AppError) => number;
  readonly print: (text: string) => number;
  readonly printJson: (value: unknown) => number;
  /** The workspace holding the current folder; null outside every one. */
  readonly here: () => Promise<Result<Workspace | null, AppError>>;
}

type TimesheetCommand = Extract<
  CliCommand,
  {
    kind:
      | "timesheet.show"
      | "timesheet.add"
      | "timesheet.edit"
      | "timesheet.delete"
      | "timesheet.day";
  }
>;

const invalid = (summary: string, path: string, message: string): ValidationError =>
  validationError(summary, [{ path, message }]);

const today = () => dayOf(systemClock.now());

/** The day given, or today. */
const dayGiven = (raw: string | null): Result<CalendarDay, ValidationError> =>
  raw === null ? ok(today()) : calendarDay(raw);

/** "13:00" as minutes after midnight. */
function minutesGiven(raw: string, path: string): Result<number, ValidationError> {
  const minutes = minutesOf(raw);
  return minutes === null
    ? err(invalid(`--${path} is not a time of day`, path, "a time such as 13:00"))
    : ok(minutes);
}

const on = (day: CalendarDay, minutes: number) => (dayStart(day) + minutes * 60_000) as Timestamp;

/**
 * The moments `--from` and `--to` name, on `--date` or else `day`, on this computer's clock. A
 * `--to` no later than `--from` is on the next day, as time over midnight is.
 */
function moments(
  fields: TimeFields,
  day: CalendarDay,
): Result<{ start?: Timestamp; end?: Timestamp }, ValidationError> {
  const date = fields.date === null ? ok(day) : calendarDay(fields.date);
  if (!date.ok) return date;
  const from = fields.from === null ? null : minutesGiven(fields.from, "from");
  if (from !== null && !from.ok) return from;
  const to = fields.to === null ? null : minutesGiven(fields.to, "to");
  if (to !== null && !to.ok) return to;
  const crosses = from !== null && to !== null && to.value <= from.value;
  return ok({
    ...(from === null ? {} : { start: on(date.value, from.value) }),
    ...(to === null ? {} : { end: on(crosses ? addDays(date.value, 1) : date.value, to.value) }),
  });
}

/** The workspace named, else the one holding the current folder; null when there is neither. */
function workspaceGiven(
  cli: TimesheetCli,
  given: string | null,
): Promise<Result<Workspace | null, AppError>> {
  if (given === null) return cli.here();
  const id = workspaceId(given);
  return Promise.resolve(id.ok ? cli.app.workspaces.find(id.value) : id);
}

/**
 * Whose timesheet the target names: the group given, else the group of the workspace given or of
 * the current folder, or that workspace's own when it is in none. Null means every timesheet.
 */
async function scopeGiven(
  cli: TimesheetCli,
  target: TimesheetTarget,
): Promise<Result<TimesheetScope | null, AppError>> {
  if (target.all) {
    return target.group === null && target.workspace === null
      ? ok(null)
      : err(invalid("--all is every timesheet", "all", "give --all alone, or --group"));
  }
  if (target.group !== null && target.workspace !== null) {
    return err(invalid("Which timesheet is unclear", "group", "give --group or --workspace"));
  }
  if (target.group !== null) {
    const group = groupName(target.group);
    return group.ok ? ok(groupScope(group.value)) : group;
  }
  const workspace = await workspaceGiven(cli, target.workspace);
  if (!workspace.ok) return workspace;
  return ok(workspace.value === null ? null : scopeOf(workspace.value));
}

const outside = () =>
  invalid("Not inside a workspace", "group", "pass --group <name> or run from a workspace folder");

/** What the fields say an entry is on, and its note; only what was given. */
const subject = (fields: TimeFields) => ({
  ...(fields.issue === null ? {} : { issue: fields.issue }),
  ...(fields.category === null ? {} : { category: fields.category }),
  ...(fields.note === null ? {} : { note: fields.note }),
});

/** The first and last day a show command covers. */
function span(
  command: Extract<TimesheetCommand, { kind: "timesheet.show" }>,
): Result<readonly [CalendarDay, CalendarDay], ValidationError> {
  if (command.span === "month") {
    const month = command.when === null ? ok(monthOf(today())) : calendarMonth(command.when);
    if (!month.ok) return month;
    const days = daysOf(month.value);
    return ok([days[0] ?? today(), days.at(-1) ?? today()]);
  }
  const day = dayGiven(command.when);
  if (!day.ok) return day;
  if (command.span === "day") return ok([day.value, day.value]);
  const monday = weekStart(day.value);
  return ok([monday, addDays(monday, 6)]);
}

async function show(
  cli: TimesheetCli,
  command: Extract<TimesheetCommand, { kind: "timesheet.show" }>,
): Promise<number> {
  const { app } = cli;
  const covered = span(command);
  if (!covered.ok) return cli.fail(covered.error);
  const scope = await scopeGiven(cli, command.target);
  if (!scope.ok) return cli.fail(scope.error);
  const [first, last] = covered.value;
  const now = systemClock.now();
  const tracked = app.timers.tracked(dayStart(first), dayStart(addDays(last, 1)), scope.value);
  if (!tracked.ok) return cli.fail(tracked.error);
  const names = tracked.value.workspaces;
  const { value: on } = scope;
  if (on?.kind === "group" && ![...names.values()].some((w) => w.group === on.group)) {
    return cli.fail(notFound("group", on.group));
  }
  // Every timesheet together has no one place, leave or tasks to show.
  const records = on === null ? ok([]) : app.timers.days(on, first, last);
  if (!records.ok) return cli.fail(records.error);
  const sheets = daySheets(first, last, tracked.value.spans, records.value, now);
  const title = on === null ? "" : `${scopeName(on, names)}\n`;
  const [only] = sheets;
  if (command.span === "day" && only !== undefined) {
    return command.json
      ? cli.printJson(dayJson(only, on, names, now))
      : cli.print(title + formatDay(only, names, now));
  }
  return command.json
    ? cli.printJson(sheets.map((sheet) => dayJson(sheet, on, names, now)))
    : cli.print(title + formatDays(sheets));
}

/**
 * What added time is on: the workspace or group given, else the current folder's workspace's
 * group, or the workspace itself when it is in none.
 */
async function ownerGiven(
  cli: TimesheetCli,
  fields: TimeFields,
): Promise<Result<{ workspace?: string; group?: string }, AppError>> {
  if (fields.workspace !== null || fields.group !== null) {
    return ok({
      ...(fields.workspace === null ? {} : { workspace: fields.workspace }),
      ...(fields.group === null ? {} : { group: fields.group }),
    });
  }
  const here = await cli.here();
  if (!here.ok) return here;
  if (here.value === null) return err(outside());
  return ok(here.value.group === null ? { workspace: here.value.id } : { group: here.value.group });
}

/** A scope as the commands name it. */
const named = (scope: TimesheetScope) =>
  scope.kind === "group" ? { group: scope.group } : { workspace: scope.workspaceId };

async function add(cli: TimesheetCli, fields: TimeFields): Promise<number> {
  const { app } = cli;
  if (fields.from === null || fields.to === null) {
    return cli.fail(
      invalid("When is missing", "time", "give --from and --to, such as --from 13:00 --to 13:30"),
    );
  }
  const when = moments(fields, today());
  if (!when.ok) return cli.fail(when.error);
  const owner = await ownerGiven(cli, fields);
  if (!owner.ok) return cli.fail(owner.error);
  const added = await app.commandBus.invoke(app.timesheetCommands.add, {
    ...owner.value,
    ...subject(fields),
    ...when.value,
  });
  if (!added.ok) return cli.fail(added.error);
  const { id, start, end, issueKey, category } = added.value;
  const minutes = Math.round((end - start) / 60_000);
  return cli.print(`✓ Added ${minutes}m for ${issueKey ?? category} (${id})\n`);
}

/** Changes added time; a timer's stretch is named "<timer id>:<n>" and only its time changes. */
async function edit(
  cli: TimesheetCli,
  command: Extract<TimesheetCommand, { kind: "timesheet.edit" }>,
): Promise<number> {
  const { app } = cli;
  const { fields } = command;
  const stretch = /^(.+):(\d+)$/.exec(command.id);
  if (stretch === null) {
    const id = entryId(command.id);
    if (!id.ok) return cli.fail(id.error);
    const found = app.timers.entry(id.value);
    if (!found.ok) return cli.fail(found.error);
    // Times given alone are on the entry's own day.
    const when = moments(fields, found.value === null ? today() : dayOf(found.value.start));
    if (!when.ok) return cli.fail(when.error);
    const edited = await app.commandBus.invoke(app.timesheetCommands.edit, {
      id: command.id,
      ...subject(fields),
      ...when.value,
    });
    return edited.ok ? cli.print(`✓ Changed ${command.id}\n`) : cli.fail(edited.error);
  }
  if (fields.issue !== null || fields.category !== null || fields.note !== null) {
    return cli.fail(
      invalid(
        "Only a timer's time can change",
        "change",
        "a timer's stretch takes only --from, --to and --date",
      ),
    );
  }
  const timer = timerId(stretch[1] ?? "");
  if (!timer.ok) return cli.fail(timer.error);
  const position = Number(stretch[2]);
  const found = app.timers.stretch(timer.value, position);
  if (!found.ok) return cli.fail(found.error);
  if (found.value === null) return cli.fail(notFound("stretch of a timer", command.id));
  const when = moments(fields, dayOf(found.value.start));
  if (!when.ok) return cli.fail(when.error);
  const moved = await app.commandBus.invoke(app.timesheetCommands.moveTimer, {
    timer: timer.value,
    position,
    start: when.value.start ?? found.value.start,
    end: when.value.end ?? found.value.end,
  });
  return moved.ok ? cli.print(`✓ Changed ${command.id}\n`) : cli.fail(moved.error);
}

async function remove(
  cli: TimesheetCli,
  command: Extract<TimesheetCommand, { kind: "timesheet.delete" }>,
): Promise<number> {
  const { app } = cli;
  const input = { id: command.id };
  let removed = await app.commandBus.invoke(app.timesheetCommands.remove, input);
  if (!removed.ok && removed.error.kind === "confirmation-required" && command.yes) {
    removed = await app.commandBus.invoke(app.timesheetCommands.remove, input, {
      confirmation: confirmationTokenFor(removed.error),
    });
  }
  return removed.ok ? cli.print(`✓ Deleted ${command.id}\n`) : cli.fail(removed.error);
}

async function setDay(
  cli: TimesheetCli,
  command: Extract<TimesheetCommand, { kind: "timesheet.day" }>,
): Promise<number> {
  const { app } = cli;
  const day = dayGiven(command.day);
  if (!day.ok) return cli.fail(day.error);
  const scope = await scopeGiven(cli, command.target);
  if (!scope.ok) return cli.fail(scope.error);
  if (scope.value === null) {
    return cli.fail(
      command.target.all
        ? invalid("--all is only for showing", "all", "a day is set on one timesheet")
        : outside(),
    );
  }
  const set = await app.commandBus.invoke(app.timesheetCommands.setDay, {
    ...named(scope.value),
    day: day.value,
    ...(command.place === null ? {} : { place: command.place }),
    ...(command.leave === null ? {} : { leave: command.leave }),
    ...(command.tasks === null ? {} : { tasks: command.tasks }),
  });
  return set.ok ? cli.print(`✓ Changed ${day.value}\n`) : cli.fail(set.error);
}

export function runTimesheet(
  cli: TimesheetCli,
  command: TimesheetCommand,
): Promise<number> | number {
  switch (command.kind) {
    case "timesheet.show":
      return show(cli, command);
    case "timesheet.add":
      return add(cli, command.fields);
    case "timesheet.edit":
      return edit(cli, command);
    case "timesheet.delete":
      return remove(cli, command);
    case "timesheet.day":
      return setDay(cli, command);
    default:
      return assertNever(command);
  }
}
