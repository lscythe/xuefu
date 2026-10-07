import { type Accessor, createSignal, onCleanup, Show } from "solid-js";
import type { Clock } from "../../application/ports/clock";
import type { TimerView } from "../../application/timesheet/queries";
import type { Workspace } from "../../domain/workspace/workspace";
import { PALETTE } from "../theme/palette";
import type { IconSet } from "../theme/status";
import { headerClock } from "./header-clock";
import { type HeaderTimer, headerTimer } from "./header-timer";
import { truncateToWidth } from "./tab-labels";

export interface HeaderProps {
  readonly clock: Clock;
  readonly timeZone: string | undefined;
  readonly tickMs: number;
  readonly icons: IconSet;
  readonly workspace: Workspace | null;
  readonly timer: TimerView | null;
  /** Terminal columns; a long workspace name is shortened to keep the right side whole. */
  readonly width: number;
}

/** "血符 XUEFU  │  " before the workspace name. */
const BRAND_WIDTH = 15;
/** Padding on both sides plus at least two columns between the two halves. */
const CHROME = 4;

export function Header(props: HeaderProps) {
  const [now, setNow] = createSignal(props.clock.now());
  // The tick only re-reads the clock; nothing accumulates, so sleep/wake cannot drift.
  const timer = setInterval(() => setNow(props.clock.now()), props.tickMs);
  onCleanup(() => clearInterval(timer));

  const clock = () => headerClock(now(), props.timeZone);
  const separator = () => (props.icons === "ascii" ? " | " : " • ");
  const tracked = () => headerTimer(props.timer, props.workspace?.id ?? null, now());
  const right = () => {
    const t = tracked();
    const timerText = t === null ? "" : `${separator()}${t.label} ${t.clock}`;
    return `${clock().date}${separator()}${clock().time}${timerText}`;
  };
  const name = () =>
    truncateToWidth(
      props.workspace?.name ?? "",
      Math.max(1, props.width - BRAND_WIDTH - CHROME - Bun.stringWidth(right())),
    );

  return (
    <box
      flexDirection="row"
      justifyContent="space-between"
      height={1}
      paddingX={1}
      backgroundColor={PALETTE.panelBg}
    >
      <text>
        <span style={{ fg: PALETTE.accentPrimary }}>
          <b>血符</b>
        </span>
        <b> XUEFU</b>
        <span style={{ fg: PALETTE.textDim }}>{"  │  "}</span>
        {props.workspace === null ? (
          <span style={{ fg: PALETTE.textMuted }}>No workspace</span>
        ) : (
          <span style={{ fg: PALETTE.text }}>{name()}</span>
        )}
      </text>
      <text fg={PALETTE.textMuted}>
        {`${clock().date}${separator()}`}
        <span style={{ fg: PALETTE.text }}>{clock().time}</span>
        <Show when={tracked()}>
          {(t: Accessor<HeaderTimer>) => (
            <>
              {`${separator()}${t().label} `}
              <span style={{ fg: t().paused ? PALETTE.warning : PALETTE.success }}>
                <b>{t().clock}</b>
              </span>
            </>
          )}
        </Show>
      </text>
    </box>
  );
}
