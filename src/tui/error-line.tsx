import type { AppError } from "../application/errors";
import { PALETTE } from "./theme/palette";

/** Error text stays Bone White beside a vermilion glyph: vermilion text is too low-contrast. */
export function ErrorLine(props: { error: AppError; ascii: boolean }) {
  return (
    <text>
      <span style={{ fg: PALETTE.error }}>{props.ascii ? "[x] " : "✗ "}</span>
      <span style={{ fg: PALETTE.text }}>{props.error.message}</span>
    </text>
  );
}
