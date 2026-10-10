import { type Accessor, For, Show } from "solid-js";
import type { Clock } from "../../application/ports/clock";
import type { TimerView } from "../../application/timesheet/queries";
import type { OpenTabs } from "../../application/workspace/queries";
import { wallClock } from "../../domain/shared/wall-clock";
import { PALETTE } from "../theme/palette";
import type { IconSet } from "../theme/status";
import { useNow } from "../use-now";
import { type HeaderTimer, headerTimer, headerTimerText } from "./header-timer";
import { fitTabLabels, TAB_CHROME } from "./tab-labels";

export interface HeaderProps {
  readonly clock: Clock;
  readonly timeZone: string | undefined;
  readonly tickMs: number;
  readonly icons: IconSet;
  readonly tabs: OpenTabs;
  readonly timer: TimerView | null;
  /** Terminal columns; tab names are shortened to keep the right side whole. */
  readonly width: number;
}

/** "血符  " before the tabs. */
const BRAND_WIDTH = 6;
/** Padding on both sides plus at least two columns between the tabs and the right side. */
const CHROME = 4;
/** Below this the date is left out and only the time is shown. */
const DATE_MIN_WIDTH = 100;

/**
 * Two rows: the 血符 mark and a tab per open workspace, the one in front filled lavender, with the
 * timer and clock on the right; then a line under the tab in front.
 */
export function Header(props: HeaderProps) {
  const now = useNow(props.clock, props.tickMs);
  const ascii = () => props.icons === "ascii";

  const clock = () => {
    const at = wallClock(now(), props.timeZone);
    return props.width < DATE_MIN_WIDTH ? at.time : `${at.date}  ${at.time}`;
  };
  const tracked = () => headerTimer(props.timer, props.tabs.active?.id ?? null, now());
  const separator = () => (ascii() ? "  |  " : "  │  ");
  const right = () => {
    const t = tracked();
    return t === null ? clock() : `${headerTimerText(t, ascii())}${separator()}${clock()}`;
  };
  const labels = () =>
    fitTabLabels(
      props.tabs.open.map((w) => w.name),
      props.width - BRAND_WIDTH - CHROME - Bun.stringWidth(right()),
    );
  const front = () => props.tabs.open.findIndex((w) => w.id === props.tabs.active?.id);
  /** A line under the tab in front, as long as the tab. */
  const underline = () => {
    const index = front();
    if (index === -1) return "";
    const before = labels()
      .slice(0, index)
      .reduce((sum, label) => sum + Bun.stringWidth(label) + TAB_CHROME, 0);
    const width = Bun.stringWidth(labels()[index] ?? "") + TAB_CHROME;
    return " ".repeat(BRAND_WIDTH + before) + (ascii() ? "-" : "▔").repeat(width);
  };

  return (
    <box flexDirection="column" height={2} paddingX={1}>
      <box flexDirection="row" justifyContent="space-between" height={1}>
        <text>
          <span style={{ fg: PALETTE.accentPrimary }}>
            <b>血符</b>
          </span>
          {"  "}
          <Show
            when={props.tabs.open.length > 0}
            fallback={<span style={{ fg: PALETTE.textMuted }}>No workspace open</span>}
          >
            <For each={props.tabs.open}>
              {(_workspace, index) => {
                const active = () => index() === front();
                const fg = () => (active() ? PALETTE.textInverse : PALETTE.textMuted);
                const bg = () => (active() ? PALETTE.accentSecondary : PALETTE.bg);
                return (
                  <span style={{ fg: fg(), bg: bg() }}>
                    {active() ? (
                      <b>{` ${index() + 1} ${labels()[index()]} `}</b>
                    ) : (
                      ` ${index() + 1} ${labels()[index()]} `
                    )}
                  </span>
                );
              }}
            </For>
          </Show>
        </text>
        <text fg={PALETTE.textMuted}>
          <Show when={tracked()}>
            {(t: Accessor<HeaderTimer>) => (
              <>
                {t().owner === null ? "" : `${t().owner} `}
                <span style={{ fg: t().paused ? PALETTE.warning : PALETTE.success }}>
                  {ascii() ? "* " : "● "}
                </span>
                <span style={{ fg: PALETTE.text }}>
                  <b>{t().clock}</b>
                </span>
                {t().paused ? " paused" : ""}
                <span style={{ fg: PALETTE.textDim }}>{separator()}</span>
              </>
            )}
          </Show>
          {clock()}
        </text>
      </box>
      <text fg={PALETTE.accentSecondary}>{underline()}</text>
    </box>
  );
}
