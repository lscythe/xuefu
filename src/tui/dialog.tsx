import type { JSX } from "solid-js";
import { PALETTE } from "./theme/palette";

const MAX_WIDTH = 64;
const MAX_LIST_ROWS = 12;

/** Up to 64 columns, keeping a margin on narrow terminals. */
export function dialogWidth(columns: number): number {
  return Math.min(MAX_WIDTH, columns - 4);
}

/** Room left for a one-line message when there is nothing to list. */
const MIN_LIST_ROWS = 2;

/**
 * Rows a dialog's list gets: enough for every item before any filtering, up to what the terminal
 * allows. Sized to the whole list, not the matches, so typing never resizes the dialog.
 */
export function dialogListRows(rows: number, items: number): number {
  const room = Math.max(3, Math.min(MAX_LIST_ROWS, rows - 10));
  return Math.min(room, Math.max(MIN_LIST_ROWS, items));
}

/** A framed box over the cockpit, centred both ways. */
export function Dialog(props: { title: string; width: number; children: JSX.Element }) {
  return (
    <box
      position="absolute"
      zIndex={10}
      top={0}
      left={0}
      width="100%"
      height="100%"
      justifyContent="center"
      alignItems="center"
    >
      <box
        width={props.width}
        flexDirection="column"
        border
        borderColor={PALETTE.borderFocused}
        // panelBg, not elevatedBg: the selection colour is elevatedBg's twin and would vanish.
        backgroundColor={PALETTE.panelBg}
        title={props.title}
        titleColor={PALETTE.accentSecondary}
        paddingX={1}
      >
        {props.children}
      </box>
    </box>
  );
}
