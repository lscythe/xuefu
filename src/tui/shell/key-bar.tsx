import { For } from "solid-js";
import { PALETTE } from "../theme/palette";
import type { KeyHint } from "./keymap";

export function KeyBar(props: { readonly hints: readonly KeyHint[] }) {
  return (
    <box height={1} paddingX={1} backgroundColor={PALETTE.panelBg}>
      <text>
        <For each={props.hints}>
          {(hint) => (
            <>
              <span style={{ fg: PALETTE.text, bg: PALETTE.elevatedBg }}>{hint.keys}</span>
              <span style={{ fg: PALETTE.textMuted }}>{` ${hint.label}  `}</span>
            </>
          )}
        </For>
      </text>
    </box>
  );
}
