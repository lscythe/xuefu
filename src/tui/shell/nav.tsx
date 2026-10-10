import { For } from "solid-js";
import { Panel } from "../panel";
import { PALETTE } from "../theme/palette";
import type { IconSet } from "../theme/status";
import { type Section, sectionIcon } from "./sections";

export interface NavProps {
  readonly sections: readonly Section[];
  readonly selected: number;
  /** The section in front has the keyboard, so its marker dims. */
  readonly away?: boolean;
  readonly icons: IconSet;
  /** Columns the panel takes; see navWidth. */
  readonly width: number;
}

/** Below this many terminal columns the sections fold to their icons. */
const FOLD_BELOW = 100;
/** Border and padding on both sides. */
const CHROME = 4;

/**
 * The marker block: terminals draw a Nerd Font glyph two cells wide, spilling right, so it gets
 * one trailing cell; a letter sits centred in three.
 */
function block(icon: string, icons: IconSet): string {
  return icons === "nerd" ? `${icon} ` : ` ${icon} `;
}

const foldedWidth = (icons: IconSet) => CHROME + (icons === "nerd" ? 2 : 3);

export function navWidth(columns: number, icons: IconSet, sections: readonly Section[]): number {
  if (columns < FOLD_BELOW) return foldedWidth(icons);
  return foldedWidth(icons) + 1 + Math.max(...sections.map((section) => section.label.length));
}

/** The sections, the one in front marked with a lavender block; ↑↓ move between them. */
export function Nav(props: NavProps) {
  const folded = () => props.width === foldedWidth(props.icons);
  return (
    <Panel title="Go" focused={false} width={props.width}>
      <For each={props.sections}>
        {(section, index) => {
          const active = () => index() === props.selected;
          return (
            // A blank row between sections; ten of them still fit a 24-row terminal.
            <text marginTop={index() === 0 ? 0 : 1}>
              <span
                style={{
                  fg: active()
                    ? props.away
                      ? PALETTE.text
                      : PALETTE.textInverse
                    : PALETTE.textDim,
                  bg: active()
                    ? props.away
                      ? PALETTE.selectionBg
                      : PALETTE.accentSecondary
                    : PALETTE.bg,
                }}
              >
                {block(sectionIcon(section, props.icons), props.icons)}
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
