import { PALETTE } from "../theme/palette";
import { MIN_COLUMNS, MIN_ROWS } from "./terminal-size";

export function TooSmall(props: { readonly width: number; readonly height: number }) {
  return (
    <box flexGrow={1} flexDirection="column" alignItems="center" justifyContent="center">
      <text fg={PALETTE.warning}>Terminal too small</text>
      <text fg={PALETTE.text}>
        {`Need ${MIN_COLUMNS}×${MIN_ROWS}, have ${props.width}×${props.height}`}
      </text>
      <text fg={PALETTE.textMuted}>Resize the window, or press q to quit</text>
    </box>
  );
}
