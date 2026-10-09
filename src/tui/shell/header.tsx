import { type Accessor, Show } from "solid-js";
import type { Clock } from "../../application/ports/clock";
import type { TimerView } from "../../application/timesheet/queries";
import { wallClock } from "../../domain/shared/wall-clock";
import type { WorkContext } from "../../domain/work/work-context";
import type { Workspace } from "../../domain/workspace/workspace";
import { PALETTE } from "../theme/palette";
import type { IconSet } from "../theme/status";
import { useNow } from "../use-now";
import { fitHeaderLeft } from "./header-fit";
import { type HeaderTimer, headerTimer } from "./header-timer";

export interface HeaderProps {
  readonly clock: Clock;
  readonly timeZone: string | undefined;
  readonly tickMs: number;
  readonly icons: IconSet;
  readonly workspace: Workspace | null;
  /** The front workspace's work in progress, shown after its name. */
  readonly work: WorkContext | null;
  readonly timer: TimerView | null;
  /** Terminal columns; a long workspace name is shortened to keep the right side whole. */
  readonly width: number;
}

/** "血符 XUEFU  │  " before the workspace name. */
const BRAND_WIDTH = 15;
/** Padding on both sides plus at least two columns between the two halves. */
const CHROME = 4;

export function Header(props: HeaderProps) {
  const now = useNow(props.clock, props.tickMs);

  const clock = () => wallClock(now(), props.timeZone);
  const separator = () => (props.icons === "ascii" ? " | " : " • ");
  const tracked = () => headerTimer(props.timer, props.workspace?.id ?? null, now());
  const right = () => {
    const t = tracked();
    const timerText = t === null ? "" : `${separator()}${t.label} ${t.clock}`;
    return `${clock().date}${separator()}${clock().time}${timerText}`;
  };
  const left = () =>
    fitHeaderLeft(
      props.workspace?.name ?? "",
      props.work === null ? null : { key: props.work.issueKey, title: props.work.title },
      props.width - BRAND_WIDTH - CHROME - Bun.stringWidth(right()),
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
          <span style={{ fg: PALETTE.text }}>{left().name}</span>
        )}
        <Show when={props.work}>
          {(work: Accessor<WorkContext>) => (
            <>
              <span style={{ fg: PALETTE.textDim }}>{"  │  "}</span>
              <span style={{ fg: PALETTE.accentSecondary }}>
                <b>{work().issueKey}</b>
              </span>
              <span style={{ fg: PALETTE.textMuted }}>
                {left().title === null ? "" : ` ${left().title}`}
              </span>
            </>
          )}
        </Show>
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
