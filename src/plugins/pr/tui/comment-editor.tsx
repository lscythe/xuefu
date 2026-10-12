import type { TextareaRenderable } from "@opentui/core";
import { useKeyboard, useTerminalDimensions } from "@opentui/solid";
import { type Accessor, createSignal, Show } from "solid-js";
import type { AppError } from "../../../application/errors";
import type { Result } from "../../../domain/shared/result";
import { Dialog, dialogWidth } from "../../../tui/dialog";
import { ErrorLine } from "../../../tui/error-line";
import { PALETTE } from "../../../tui/theme/palette";
import type { IconSet } from "../../../tui/theme/status";

export interface CommentEditorProps {
  /** What it comments on, as the title says it, such as "app/src/Login.kt, line 11". */
  readonly on: string;
  /** The text as left last time; empty for a fresh one. */
  readonly draft: string;
  readonly icons: IconSet;
  /** Posts the text, asking first; null when that was declined. */
  readonly post: (text: string) => Promise<Result<unknown, AppError> | null>;
  /** Called with the text as it stands, so closing never loses it. */
  readonly onDraft: (text: string) => void;
  /** Closes the editor, saying whether the comment was posted. */
  readonly onClose: (posted: boolean) => void;
}

const ROWS = 6;

/**
 * A comment in a text area: Ctrl+S posts it, asking first, and Esc closes, keeping the text for
 * next time. While it is being posted, the keys are the confirmation's.
 */
export function CommentEditor(props: CommentEditorProps) {
  const dimensions = useTerminalDimensions();
  const [text, setText] = createSignal(props.draft);
  const [posting, setPosting] = createSignal(false);
  const [error, setError] = createSignal<AppError | null>(null);
  let area: TextareaRenderable | undefined;

  const post = async () => {
    if (posting() || text().trim() === "") return;
    setPosting(true);
    setError(null);
    const posted = await props.post(text());
    setPosting(false);
    if (posted === null) return;
    if (posted.ok) props.onClose(true);
    else setError(posted.error);
  };

  useKeyboard((key) => {
    if (posting()) return;
    if (key.name === "escape" || (key.ctrl && key.name === "c")) {
      props.onDraft(text());
      props.onClose(false);
      return;
    }
    if (key.ctrl && key.name === "s") void post();
  });

  return (
    <Dialog title={` Comment on ${props.on} `} width={dialogWidth(dimensions().width)}>
      <textarea
        ref={(element: TextareaRenderable) => {
          area = element;
        }}
        initialValue={props.draft}
        focused={!posting()}
        height={ROWS}
        wrapMode="word"
        placeholder="What to say. Markdown works, as on Bitbucket."
        placeholderColor={PALETTE.textDim}
        backgroundColor={PALETTE.panelBg}
        focusedBackgroundColor={PALETTE.panelBg}
        textColor={PALETTE.text}
        focusedTextColor={PALETTE.text}
        cursorColor={PALETTE.cursor}
        selectionBg={PALETTE.selectionBg}
        onContentChange={() => setText(area?.plainText ?? "")}
      />
      <Show when={error()}>
        {(shown: Accessor<AppError>) => (
          <ErrorLine error={shown()} ascii={props.icons === "ascii"} />
        )}
      </Show>
      <text fg={PALETTE.textMuted}>
        {posting() ? "Posting..." : "ctrl+s post  esc close, keeping it"}
      </text>
    </Dialog>
  );
}
