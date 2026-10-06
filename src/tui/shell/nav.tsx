import { For } from "solid-js";
import { PALETTE } from "../theme/palette";
import type { IconSet } from "../theme/status";
import { SECTIONS, sectionIcon } from "./sections";

export interface NavProps {
  readonly selected: number;
  readonly icons: IconSet;
}

export function Nav(props: NavProps) {
  const marker = () => (props.icons === "ascii" ? ">" : "▌");
  return (
    <box
      flexDirection="column"
      width={16}
      border
      borderColor={PALETTE.borderIdle}
      backgroundColor={PALETTE.panelBg}
    >
      <For each={SECTIONS}>
        {(section, index) => {
          const active = () => index() === props.selected;
          const icon = () => sectionIcon(section, props.icons);
          return (
            <text bg={active() ? PALETTE.selectionBg : PALETTE.panelBg}>
              <span style={{ fg: PALETTE.borderFocused }}>{active() ? marker() : " "}</span>
              <span style={{ fg: active() ? PALETTE.selectionFg : PALETTE.textMuted }}>
                {`${icon() ?? ""} ${section.label}`}
              </span>
            </text>
          );
        }}
      </For>
    </box>
  );
}
