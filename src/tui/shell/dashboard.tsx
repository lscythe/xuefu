import { type Accessor, Show } from "solid-js";
import type { ActivityEntry } from "../../application/activity/queries";
import type { AppError } from "../../application/errors";
import type { Clock } from "../../application/ports/clock";
import type { TimerView, TrackedTime } from "../../application/timesheet/queries";
import type { Result } from "../../domain/shared/result";
import type { Timestamp } from "../../domain/shared/time";
import type { WorkContext } from "../../domain/work/work-context";
import type { Workspace } from "../../domain/workspace/workspace";
import { Panel } from "../panel";
import { useNow } from "../use-now";
import { ActivityPanel } from "./activity-panel";
import { type LoadedNotes, NotesPanel } from "./notes-panel";
import { noteKeys, panelKeys, sectionStatus } from "./panel-status";
import type { Section } from "./sections";
import { TodayPanel, todayTotal } from "./today-panel";
import { WorkPanel } from "./work-panel";

/** The dashboard's panels in focus order; each opens its own section. */
export const DASHBOARD_PANELS: readonly Section["id"][] = [
  "work",
  "timesheet",
  "notes",
  "activity",
];

export interface DashboardProps {
  readonly clock: Clock;
  readonly timeZone: string | undefined;
  readonly tickMs: number;
  readonly ascii: boolean;
  readonly workspace: Workspace | null;
  readonly work: WorkContext | null;
  readonly timer: TimerView | null;
  readonly notes: Result<LoadedNotes, AppError> | null;
  readonly activity: Result<readonly ActivityEntry[], AppError> | null;
  readonly tracked: Result<TrackedTime, AppError> | null;
  /** Midnight, where today's tracked time starts. */
  readonly since: Timestamp;
  /** Columns and rows the dashboard may fill. */
  readonly width: number;
  readonly rows: number;
  /** Index into DASHBOARD_PANELS. */
  readonly focused: number;
  /** What the timer key does, for the Work panel's frame. */
  readonly timerKeys: string | null;
}

/** The panel's frame and padding. */
const CHROME = 4;
/** Room for a large clock and its caption; with less the clock is drawn small. */
const TALL_WORK = 10;
const SHORT_WORK = 8;
const TALL_BELOW = 22;
const SIDE_MIN = 30;
const SIDE_MAX = 48;

/** The side column takes two fifths of the width, within limits. */
function sideWidth(width: number): number {
  return Math.min(SIDE_MAX, Math.max(SIDE_MIN, Math.round(width * 0.4)));
}

/** Work beside Today across the top, then Notes beside Activity, each numbered for its digit key. */
export function Dashboard(props: DashboardProps) {
  const now = useNow(props.clock, props.tickMs);
  const top = () => (props.rows >= TALL_BELOW ? TALL_WORK : SHORT_WORK);
  const side = () => sideWidth(props.width);
  const focused = (id: Section["id"]) => DASHBOARD_PANELS[props.focused] === id;
  const number = (id: Section["id"]) => DASHBOARD_PANELS.indexOf(id) + 1;
  const open = () => (props.ascii ? "enter open" : "⏎ open");
  const status = (id: Section["id"]) =>
    sectionStatus(id, {
      work: props.work,
      timer: props.timer,
      workspace: props.workspace,
      today: todayTotal(props.tracked, props.since, now()),
    });

  return (
    <box flexDirection="column" flexGrow={1}>
      <box flexDirection="row" height={top()}>
        <Panel
          number={number("work")}
          title="Work"
          focused={focused("work")}
          flexGrow={1}
          status={status("work")}
          keys={panelKeys([props.timerKeys, open()], props.ascii)}
        >
          <WorkPanel
            clock={props.clock}
            timeZone={props.timeZone}
            tickMs={props.tickMs}
            workspace={props.workspace}
            work={props.work}
            timer={props.timer}
            width={props.width - side() - CHROME}
            rows={top() - 2}
            ascii={props.ascii}
          />
        </Panel>
        <Panel
          number={number("timesheet")}
          title="Today"
          focused={focused("timesheet")}
          width={side()}
          status={status("timesheet")}
          keys={open()}
        >
          <Show when={props.tracked}>
            {(tracked: Accessor<Result<TrackedTime, AppError>>) => (
              <TodayPanel
                clock={props.clock}
                tickMs={props.tickMs}
                tracked={tracked()}
                since={props.since}
                width={side() - CHROME}
                rows={top() - 2}
                ascii={props.ascii}
              />
            )}
          </Show>
        </Panel>
      </box>
      <box flexDirection="row" flexGrow={1}>
        <Panel
          number={number("notes")}
          title="Notes"
          focused={focused("notes")}
          flexGrow={1}
          status={status("notes")}
          keys={
            props.workspace === null
              ? open()
              : panelKeys([noteKeys(props.work, props.ascii), open()], props.ascii)
          }
        >
          <NotesPanel
            workspace={props.workspace}
            work={props.work}
            notes={props.notes}
            ascii={props.ascii}
          />
        </Panel>
        <Panel
          number={number("activity")}
          title="Activity"
          focused={focused("activity")}
          width={side()}
          status={status("activity")}
          keys={open()}
        >
          <Show when={props.activity}>
            {(activity: Accessor<Result<readonly ActivityEntry[], AppError>>) => (
              <ActivityPanel
                clock={props.clock}
                timeZone={props.timeZone}
                tickMs={props.tickMs}
                workspace={props.workspace}
                activity={activity()}
                rows={props.rows - top() - 2}
                width={side() - CHROME}
                ascii={props.ascii}
              />
            )}
          </Show>
        </Panel>
      </box>
    </box>
  );
}
