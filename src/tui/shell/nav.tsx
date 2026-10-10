import { For } from "solid-js";
import { Panel } from "../panel";
import { PALETTE } from "../theme/palette";
import type { IconSet } from "../theme/status";
import { SECTIONS, sectionIcon } from "./sections";

export interface NavProps {
  readonly selected: number;
  readonly icons: IconSet;
  /** Columns the panel takes; see navWidth. */
  readonly width: number;
}

/** Below this many terminal columns the sections fold to their icons, when there are icons. */
const FOLD_BELOW = 100;
const FULL_WIDTH = 17;
const FOLDED_WIDTH = 7;

export function navWidth(columns: number, icons: IconSet): number {
  return columns < FOLD_BELOW && icons !== "ascii" ? FOLDED_WIDTH : FULL_WIDTH;
}

/** The sections, the one in front marked with a lavender block; ↑↓ move between them. */
export function Nav(props: NavProps) {
  const folded = () => props.width === FOLDED_WIDTH;
  return (
    <Panel title="Go" focused={false} width={props.width}>
      <For each={SECTIONS}>
        {(section, index) => {
          const active = () => index() === props.selected;
          const icon = () => sectionIcon(section, props.icons);
          return (
            <text>
              <span
                style={{
                  fg: active() ? PALETTE.textInverse : PALETTE.textDim,
                  bg: active() ? PALETTE.accentSecondary : PALETTE.bg,
                }}
              >
                {icon() === null ? (active() ? ">" : " ") : ` ${icon()} `}
              </span>
              <span style={{ fg: active() ? PALETTE.text : PALETTE.textMuted }}>
                {folded() ? "" : active() ? <b>{` ${section.label}`}</b> : ` ${section.label}`}
              </span>
            </text>
          );
        }}
      </For>
    </Panel>
  );
}
