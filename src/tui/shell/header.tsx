import { createSignal, onCleanup } from "solid-js";
import type { Clock } from "../../application/ports/clock";
import { PALETTE } from "../theme/palette";
import type { IconSet } from "../theme/status";
import { headerClock } from "./header-clock";

export interface HeaderProps {
  readonly clock: Clock;
  readonly timeZone: string | undefined;
  readonly tickMs: number;
  readonly icons: IconSet;
  readonly workspaceName: string | null;
}

export function Header(props: HeaderProps) {
  const [now, setNow] = createSignal(props.clock.now());
  // The tick only re-reads the clock; nothing accumulates, so sleep/wake cannot drift.
  const timer = setInterval(() => setNow(props.clock.now()), props.tickMs);
  onCleanup(() => clearInterval(timer));

  const clock = () => headerClock(now(), props.timeZone);
  const separator = () => (props.icons === "ascii" ? "|" : "•");

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
        {props.workspaceName === null ? (
          <span style={{ fg: PALETTE.textMuted }}>No workspace</span>
        ) : (
          <span style={{ fg: PALETTE.text }}>{props.workspaceName}</span>
        )}
      </text>
      <text fg={PALETTE.textMuted}>
        {`${clock().date} ${separator()} `}
        <span style={{ fg: PALETTE.success }}>{clock().time}</span>
      </text>
    </box>
  );
}
