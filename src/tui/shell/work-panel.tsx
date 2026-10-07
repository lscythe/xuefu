import { type Accessor, Match, Show, Switch } from "solid-js";
import type { Clock } from "../../application/ports/clock";
import type { TimerView } from "../../application/timesheet/queries";
import { clockDuration } from "../../domain/shared/time";
import type { Timer } from "../../domain/timesheet/timer";
import { elapsed } from "../../domain/timesheet/timer";
import type { WorkContext } from "../../domain/work/work-context";
import type { Workspace } from "../../domain/workspace/workspace";
import { PALETTE } from "../theme/palette";
import { useNow } from "../use-now";
import { headerClock } from "./header-clock";

export interface WorkPanelProps {
  readonly clock: Clock;
  readonly timeZone: string | undefined;
  readonly tickMs: number;
  readonly workspace: Workspace | null;
  readonly work: WorkContext | null;
  /** The active timer, wherever it runs; shown only when it times this work. */
  readonly timer: TimerView | null;
}

const label = (text: string) => <span style={{ fg: PALETTE.textMuted }}>{text.padEnd(10)}</span>;

/** The Work section: what the front workspace is being worked on, and its timer. */
export function WorkPanel(props: WorkPanelProps) {
  const now = useNow(props.clock, props.tickMs);
  const timer = () => {
    const active = props.timer?.timer ?? null;
    const work = props.work;
    return active !== null &&
      work !== null &&
      active.workspaceId === work.workspaceId &&
      active.issueKey === work.issueKey
      ? active
      : null;
  };

  return (
    <Switch>
      <Match when={props.workspace === null}>
        <text fg={PALETTE.textMuted}>Open a workspace with Ctrl+W to see its work.</text>
      </Match>
      <Match when={props.work === null}>
        <text fg={PALETTE.text}>{`Nothing in progress in ${props.workspace?.name ?? ""}.`}</text>
        <text fg={PALETTE.textMuted}>Start some with: xuefu work start {"<issue>"}</text>
      </Match>
      <Match when={props.work}>
        {(work: Accessor<WorkContext>) => (
          <>
            <text>
              <span style={{ fg: PALETTE.accentSecondary }}>
                <b>{work().issueKey}</b>
              </span>
              {work().title === null ? (
                <span style={{ fg: PALETTE.textMuted }}>{"  No title"}</span>
              ) : (
                <span style={{ fg: PALETTE.text }}>{`  ${work().title}`}</span>
              )}
            </text>
            <text> </text>
            <text>
              {label("Started")}
              <span style={{ fg: PALETTE.text }}>
                {(() => {
                  const at = headerClock(work().startedAt, props.timeZone);
                  return `${at.date} ${at.time}`;
                })()}
              </span>
            </text>
            <text>
              {label("Timer")}
              <Show
                when={timer()}
                fallback={<span style={{ fg: PALETTE.textMuted }}>not running, t starts it</span>}
              >
                {(t: Accessor<Timer>) => (
                  <>
                    <span
                      style={{ fg: t().status === "paused" ? PALETTE.warning : PALETTE.success }}
                    >
                      <b>{clockDuration(elapsed(t(), now()))}</b>
                    </span>
                    <span style={{ fg: PALETTE.textMuted }}>
                      {t().status === "paused" ? " paused" : " running"}
                    </span>
                  </>
                )}
              </Show>
            </text>
          </>
        )}
      </Match>
    </Switch>
  );
}
