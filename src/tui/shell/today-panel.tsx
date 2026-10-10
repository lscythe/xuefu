import { type Accessor, For, Match, Show, Switch } from "solid-js";
import type { AppError } from "../../application/errors";
import type { Clock } from "../../application/ports/clock";
import type { TrackedTime } from "../../application/timesheet/queries";
import type { Result } from "../../domain/shared/result";
import { type Duration, shortDuration, type Timestamp } from "../../domain/shared/time";
import { type TrackedTotal, trackedTotals } from "../../domain/timesheet/tracked";
import { ErrorLine } from "../error-line";
import { PALETTE, SERIES } from "../theme/palette";
import { useNow } from "../use-now";
import { truncateToWidth } from "./tab-labels";

export interface TodayPanelProps {
  readonly clock: Clock;
  readonly tickMs: number;
  readonly tracked: Result<TrackedTime, AppError>;
  /** Midnight, where today's time starts. */
  readonly since: Timestamp;
  /** Columns and rows inside the panel. */
  readonly width: number;
  readonly rows: number;
  readonly ascii: boolean;
}

/** "10h 05m" is as wide as a total gets in a day. */
const TIME_WIDTH = 7;
/** "● " before each row. */
const DOT_WIDTH = 2;
const KEY_WIDTH = 10;
const MIN_WHAT = 10;
/** The heading, and the gap and bar under the rows. */
const CHROME_ROWS = 3;

/** Today's tracked time, as the dashboard and the Timesheet section show it. */
interface TodayView {
  readonly totals: readonly TrackedTotal[];
  readonly total: Duration;
}

function todayView(tracked: TrackedTime, since: Timestamp, now: Timestamp): TodayView {
  const totals = trackedTotals(tracked.spans, since, now);
  return { totals, total: totals.reduce((sum, t) => sum + t.duration, 0) as Duration };
}

/** The day's total for a panel's frame, or null when there is nothing to add up. */
export function todayTotal(
  tracked: Result<TrackedTime, AppError> | null,
  since: Timestamp,
  now: Timestamp,
): string | null {
  if (tracked === null || !tracked.ok) return null;
  const { total } = todayView(tracked.value, since, now);
  return total === 0 ? null : shortDuration(total);
}

/** Each issue's share of `width` columns, every one at least a column, most first. */
function shares(totals: readonly TrackedTotal[], total: number, width: number): number[] {
  const columns = totals.map((t) => Math.max(1, Math.round((t.duration / total) * width)));
  const over = columns.reduce((sum, c) => sum + c, 0) - width;
  if (over > 0 && columns.length > 0) columns[0] = Math.max(1, (columns[0] ?? 0) - over);
  return columns;
}

/** Time tracked today per issue, across every workspace, with a bar of each one's share. */
export function TodayPanel(props: TodayPanelProps) {
  const now = useNow(props.clock, props.tickMs);
  const view = () => (props.tracked.ok ? todayView(props.tracked.value, props.since, now()) : null);
  const name = (total: TrackedTotal) =>
    (props.tracked.ok ? props.tracked.value.workspaces.get(total.workspaceId)?.name : null) ??
    total.workspaceId;
  const room = () => props.width - DOT_WIDTH - TIME_WIDTH - 1;
  const shown = () => (view()?.totals ?? []).slice(0, Math.max(1, props.rows - CHROME_ROWS));
  const row = (total: TrackedTotal) => {
    const label = total.issueKey ?? name(total);
    const keyWidth = Math.min(room(), Math.max(KEY_WIDTH, Bun.stringWidth(label) + 1));
    const whatWidth = room() - keyWidth;
    // A workspace name cut shorter than this says nothing, so the column is left empty.
    const what = total.issueKey === null || whatWidth < MIN_WHAT ? "" : name(total);
    return {
      label: truncateToWidth(label, keyWidth).padEnd(keyWidth),
      what: truncateToWidth(what, Math.max(1, whatWidth)).padEnd(whatWidth),
      time: shortDuration(total.duration).padStart(TIME_WIDTH + 1),
    };
  };

  return (
    <Switch>
      <Match when={!props.tracked.ok && props.tracked.error}>
        {(error: Accessor<AppError>) => <ErrorLine error={error()} ascii={props.ascii} />}
      </Match>
      <Match when={(view()?.totals.length ?? 0) === 0}>
        <text fg={PALETTE.textMuted}>Nothing tracked today.</text>
      </Match>
      <Match when={view()}>
        {(today: Accessor<TodayView>) => (
          <>
            <text>
              <span style={{ fg: PALETTE.textInverse, bg: PALETTE.accentSecondary }}>
                <b>{` Issue${"Time ".padStart(props.width - 6)}`}</b>
              </span>
            </text>
            <For each={shown()}>
              {(total, index) => (
                <text wrapMode="none">
                  <span style={{ fg: SERIES[index() % SERIES.length] }}>
                    {props.ascii ? "* " : "● "}
                  </span>
                  <span style={{ fg: PALETTE.text }}>{row(total).label}</span>
                  <span style={{ fg: PALETTE.textMuted }}>{row(total).what}</span>
                  <span style={{ fg: PALETTE.text }}>{row(total).time}</span>
                </text>
              )}
            </For>
            <Show when={props.rows >= shown().length + CHROME_ROWS}>
              <text> </text>
              <text wrapMode="none">
                <For each={shares(shown(), today().total, props.width)}>
                  {(columns, index) => (
                    <span style={{ fg: SERIES[index() % SERIES.length] }}>
                      {"/".repeat(columns)}
                    </span>
                  )}
                </For>
              </text>
            </Show>
          </>
        )}
      </Match>
    </Switch>
  );
}
