import type { AppError } from "../application/errors";
import { PALETTE } from "./theme/palette";

/** The error's message, with the first reason when input was rejected, so it can be fixed. */
export function errorText(error: AppError): string {
  const reason = error.kind === "validation" ? error.issues[0]?.message : undefined;
  return reason === undefined ? error.message : `${error.message}: ${reason}`;
}

/**
 * The message keeps the body colour beside a vermilion glyph: the glyph raises the alarm and the
 * text stays easy to read.
 */
export function ErrorLine(props: { error: AppError; ascii: boolean }) {
  return (
    <text>
      <span style={{ fg: PALETTE.error }}>{props.ascii ? "[x] " : "✗ "}</span>
      <span style={{ fg: PALETTE.text }}>{errorText(props.error)}</span>
    </text>
  );
}
