import { useKeyboard, useTerminalDimensions } from "@opentui/solid";
import { For } from "solid-js";
import type { ConfirmationPrompt } from "../domain/shared/confirmation";
import { Dialog, dialogWidth } from "./dialog";
import { PALETTE } from "./theme/palette";
import type { IconSet } from "./theme/status";

export interface ConfirmDialogProps {
  readonly prompt: ConfirmationPrompt;
  readonly icons: IconSet;
  /** Called once, with whether the action was approved. */
  readonly onAnswer: (approved: boolean) => void;
}

/**
 * Asks before a consequential action, naming exactly what it acts on and what follows. Enter or y
 * approves; a destructive action takes y alone, so a habitual Enter never approves one. Esc, n or
 * Ctrl+C declines.
 */
export function ConfirmDialog(props: ConfirmDialogProps) {
  const dimensions = useTerminalDimensions();
  const destructive = () => props.prompt.severity === "destructive";
  let answered = false;

  const answer = (approved: boolean) => {
    if (answered) return;
    answered = true;
    props.onAnswer(approved);
  };

  useKeyboard((key) => {
    if (key.name === "escape" || key.name === "n" || (key.ctrl && key.name === "c")) {
      answer(false);
    } else if (key.name === "y" && !key.ctrl && !key.meta) {
      answer(true);
    } else if (key.name === "return" && !destructive()) {
      answer(true);
    }
  });

  const labelWidth = () =>
    Math.max(0, ...props.prompt.details.map((detail) => Bun.stringWidth(detail.label)));
  const glyph = () => (props.icons === "ascii" ? "! " : "⚠ ");
  const label = () => props.prompt.confirmLabel.toLowerCase();

  return (
    <Dialog
      title={` ${props.prompt.title}? `}
      width={dialogWidth(dimensions().width)}
      danger={destructive()}
    >
      <For each={props.prompt.details}>
        {(detail) => (
          <text>
            <span style={{ fg: PALETTE.textMuted }}>
              {detail.label + " ".repeat(labelWidth() - Bun.stringWidth(detail.label))}
            </span>
            <span style={{ fg: PALETTE.text }}>{`  ${detail.value}`}</span>
          </text>
        )}
      </For>
      <text> </text>
      <text>
        {destructive() ? <span style={{ fg: PALETTE.error }}>{glyph()}</span> : ""}
        <span style={{ fg: PALETTE.text }}>{props.prompt.consequence}</span>
      </text>
      <text> </text>
      <text>
        <span style={{ fg: destructive() ? PALETTE.error : PALETTE.accentTertiary }}>
          {destructive() ? "y" : "enter"}
        </span>
        <span style={{ fg: PALETTE.text }}>{` ${label()}`}</span>
        <span style={{ fg: PALETTE.accentTertiary }}>{"  esc"}</span>
        <span style={{ fg: PALETTE.text }}>{" cancel"}</span>
      </text>
    </Dialog>
  );
}
