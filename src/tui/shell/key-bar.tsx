import { For } from "solid-js";
import { PALETTE } from "../theme/palette";
import type { IconSet } from "../theme/status";
import { COMMANDS_HINT, fitKeyHints, hintWidth, type KeyHint } from "./keymap";

export interface KeyBarProps {
  readonly hints: readonly KeyHint[];
  readonly icons: IconSet;
  /** Terminal columns; hints that do not fit are left to the palette. */
  readonly width: number;
}

/** The keys that work everywhere, with the palette set apart at the right. */
export function KeyBar(props: KeyBarProps) {
  // "│ " before the palette's hint.
  const shown = () => fitKeyHints(props.hints, props.width - 2 - hintWidth(COMMANDS_HINT));
  return (
    <box height={1} flexDirection="row" backgroundColor={PALETTE.panelBg}>
      <text>
        <For each={shown()}>
          {(hint) => (
            <>
              <span style={{ fg: PALETTE.accentTertiary }}>{` ${hint.keys}`}</span>
              <span style={{ fg: PALETTE.text }}>{` ${hint.label} `}</span>
            </>
          )}
        </For>
      </text>
      <box flexGrow={1} />
      <text>
        <span style={{ fg: PALETTE.textDim }}>{props.icons === "ascii" ? "| " : "│ "}</span>
        <span style={{ fg: PALETTE.accentTertiary }}>{COMMANDS_HINT.keys}</span>
        <span style={{ fg: PALETTE.text }}>{` ${COMMANDS_HINT.label} `}</span>
      </text>
    </box>
  );
}
