import { For } from "solid-js";
import { PALETTE } from "../theme/palette";
import type { IconSet } from "../theme/status";
import { COMMANDS_HINT, type KeyHint } from "./keymap";

/** The keys that work everywhere, with the palette set apart at the right. */
export function KeyBar(props: { readonly hints: readonly KeyHint[]; readonly icons: IconSet }) {
  return (
    <box height={1} flexDirection="row" backgroundColor={PALETTE.panelBg}>
      <text>
        <For each={props.hints}>
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
