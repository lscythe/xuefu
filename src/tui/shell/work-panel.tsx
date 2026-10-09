import { type Accessor, For, Match, Show, Switch } from "solid-js";
import type { Clock } from "../../application/ports/clock";
import type { TimerView } from "../../application/timesheet/queries";
import { clockDuration } from "../../domain/shared/time";
import { wallClock } from "../../domain/shared/wall-clock";
import type { Timer } from "../../domain/timesheet/timer";
import { elapsed } from "../../domain/timesheet/timer";
import type { WorkContext } from "../../domain/work/work-context";
import type { Workspace } from "../../domain/workspace/workspace";
import { bigClockRows, type ClockSize, fitClock } from "../big-clock";
import { PALETTE } from "../theme/palette";
import { useNow } from "../use-now";
import { truncateToWidth } from "./tab-labels";

export interface WorkPanelProps {
  readonly clock: Clock;
  readonly timeZone: string | undefined;
  readonly tickMs: number;
  readonly workspace: Workspace | null;
  readonly work: WorkContext | null;
  /** The active timer, wherever it runs; shown only when it times this work. */
  readonly timer: TimerView | null;
  /** Columns and rows inside the panel; the clock is drawn as large as they allow. */
  readonly width: number;
  readonly rows: number;
  readonly ascii: boolean;
}

/** The issue and its title, then when it started, under the clock. */
const CAPTION_ROWS = 3;

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

  const started = (work: WorkContext) => {
    const at = wallClock(work.startedAt, props.timeZone);
    return `${at.date} ${at.time}`;
  };
  const shown = () => {
    const t = timer();
    return t === null ? null : clockDuration(elapsed(t, now()));
  };
  /** The clock's size, or null to write the time on a line of its own. */
  const size = (): ClockSize | null => {
    const text = shown();
    if (props.ascii || text === null) return null;
    return fitClock(text, props.width, props.rows - CAPTION_ROWS);
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
      <Match when={props.work !== null && size() !== null && props.work}>
        {(work: Accessor<WorkContext>) => {
          const paused = () => timer()?.status === "paused";
          const title = () =>
            work().title === null
              ? null
              : truncateToWidth(work().title ?? "", props.width - work().issueKey.length - 2);
          return (
            <box flexDirection="column" alignItems="center">
              <For each={bigClockRows(shown() ?? "", size() ?? "small")}>
                {(row) => (
                  <text fg={paused() ? PALETTE.textMuted : PALETTE.accentTertiary}>{row}</text>
                )}
              </For>
              <text> </text>
              <text>
                <span style={{ fg: PALETTE.accentSecondary }}>
                  <b>{work().issueKey}</b>
                </span>
                <Show when={title()}>
                  {(text: Accessor<string>) => (
                    <span style={{ fg: PALETTE.text }}>{`  ${text()}`}</span>
                  )}
                </Show>
              </text>
              <text>
                <span style={{ fg: PALETTE.textMuted }}>{`Started ${started(work())} · `}</span>
                <span style={{ fg: paused() ? PALETTE.warning : PALETTE.success }}>
                  {paused() ? "paused" : "running"}
                </span>
              </text>
            </box>
          );
        }}
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
              <span style={{ fg: PALETTE.text }}>{started(work())}</span>
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
                      <b>{shown()}</b>
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
