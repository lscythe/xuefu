import { applyGain, type BoxRenderable, type OptimizedBuffer } from "@opentui/core";
import { Portal, useRenderer } from "@opentui/solid";
import { type JSX, onCleanup } from "solid-js";
import { PALETTE } from "./theme/palette";

const MAX_WIDTH = 64;

/** How bright the cockpit stays behind a dialog: dim enough to recede, bright enough to read. */
const BEHIND = 0.45;

/** The cells of a `width` by `height` screen outside a box, as a mask for OpenTUI's filters. */
export function outsideMask(
  width: number,
  height: number,
  box: { readonly x: number; readonly y: number; readonly width: number; readonly height: number },
): Float32Array {
  const inside = (x: number, y: number) =>
    x >= box.x && x < box.x + box.width && y >= box.y && y < box.y + box.height;
  const cells: number[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!inside(x, y)) cells.push(x, y, 1);
    }
  }
  return new Float32Array(cells);
}

// Dialogs on screen, the newest last; one can open over another, as a confirmation over a picker.
const open: symbol[] = [];
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

/** Makes the portal's own box cover the screen, so the dialog centres on the whole cockpit. */
function cover(container: BoxRenderable) {
  container.position = "absolute";
  container.top = 0;
  container.left = 0;
  container.width = "100%";
  container.height = "100%";
  container.zIndex = 10;
}

/**
 * A framed box over the cockpit, centred both ways; the cockpit dims behind it while it is open.
 * It is drawn at the root wherever it is declared, so a section's dialog centres on the screen
 * rather than on the section.
 */
export function Dialog(props: {
  title: string;
  width: number;
  /** Framed in vermilion, for what cannot be undone. */
  danger?: boolean;
  children: JSX.Element;
}) {
  const renderer = useRenderer();
  const id = Symbol("dialog");
  let frame: BoxRenderable | undefined;
  let mask: { readonly key: string; readonly cells: Float32Array } | null = null;
  // After each frame is drawn, everything but the newest dialog is dimmed, the dialogs under it
  // included, so the one with the keyboard is plain to see.
  const dim = (buffer: OptimizedBuffer) => {
    if (open.at(-1) !== id || frame === undefined) return;
    const box = { x: frame.x, y: frame.y, width: frame.width, height: frame.height };
    const key = `${buffer.width}x${buffer.height}@${box.x},${box.y},${box.width},${box.height}`;
    if (mask?.key !== key) {
      mask = { key, cells: outsideMask(buffer.width, buffer.height, box) };
    }
    applyGain(buffer, BEHIND, mask.cells);
  };
  open.push(id);
  renderer.addPostProcessFn(dim);
  onCleanup(() => {
    open.splice(open.indexOf(id), 1);
    renderer.removePostProcessFn(dim);
  });
  return (
    <Portal ref={(container) => cover(container as BoxRenderable)}>
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
          ref={(box: BoxRenderable) => {
            frame = box;
          }}
          width={props.width}
          flexDirection="column"
          border
          borderColor={props.danger ? PALETTE.error : PALETTE.borderFocused}
          // panelBg, not elevatedBg: the selection colour is elevatedBg's twin and would vanish.
          backgroundColor={PALETTE.panelBg}
          title={props.title}
          titleColor={props.danger ? PALETTE.error : PALETTE.accentSecondary}
          paddingX={1}
        >
          {props.children}
        </box>
      </box>
    </Portal>
  );
}
