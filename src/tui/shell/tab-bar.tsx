import { For } from "solid-js";
import type { OpenTabs } from "../../application/workspace/queries";
import { PALETTE } from "../theme/palette";
import { fitTabLabels } from "./tab-labels";

/** One row of " 1 Mobile Banking " tabs; the number is the Alt+digit that focuses it. */
export function TabBar(props: { readonly tabs: OpenTabs; readonly width: number }) {
  // paddingX takes one column on each side.
  const labels = () =>
    fitTabLabels(
      props.tabs.open.map((w) => w.name),
      props.width - 2,
    );
  return (
    <box height={1} paddingX={1} backgroundColor={PALETTE.panelBg}>
      <text>
        <For each={props.tabs.open}>
          {(workspace, index) => {
            const active = () => workspace.id === props.tabs.active?.id;
            const bg = () => (active() ? PALETTE.selectionBg : PALETTE.panelBg);
            return (
              <>
                <span
                  style={{ fg: active() ? PALETTE.accentPrimary : PALETTE.textMuted, bg: bg() }}
                >
                  {active() ? <b>{` ${index() + 1} `}</b> : ` ${index() + 1} `}
                </span>
                <span style={{ fg: active() ? PALETTE.selectionFg : PALETTE.textMuted, bg: bg() }}>
                  {active() ? <b>{`${labels()[index()]} `}</b> : `${labels()[index()]} `}
                </span>
              </>
            );
          }}
        </For>
      </text>
    </box>
  );
}
