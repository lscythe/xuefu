import type { TextareaRenderable } from "@opentui/core";
import { useKeyboard, useTerminalDimensions } from "@opentui/solid";
import { type Accessor, createSignal, Match, Show, Switch } from "solid-js";
import type { AppError } from "../../application/errors";
import type { SavedNote } from "../../application/notes/commands";
import type { Result } from "../../domain/shared/result";
import { Dialog, dialogWidth } from "../dialog";
import { ErrorLine } from "../error-line";
import { PALETTE } from "../theme/palette";
import type { IconSet } from "../theme/status";

export interface NoteEditorProps {
  /** What the note is about: the workspace's name, or the issue key. */
  readonly subject: string;
  /** The note as stored, unmasked; empty when there is none yet. */
  readonly text: string;
  readonly icons: IconSet;
  /** Saves the text; blank text clears the note. */
  readonly save: (text: string) => Promise<Result<SavedNote, AppError>>;
  readonly onClose: () => void;
}

const MAX_ROWS = 16;
const MIN_ROWS = 3;
/** The dialog's frame, the footer and the margin the dialog keeps from the terminal's edges. */
const CHROME_ROWS = 10;

/**
 * A note in a text area: Ctrl+S saves, Esc closes. Unsaved text is never dropped on one key: Esc
 * (or Ctrl+C) first asks, and only a second press discards.
 */
export function NoteEditor(props: NoteEditorProps) {
  const dimensions = useTerminalDimensions();
  const [text, setText] = createSignal(props.text);
  const [discarding, setDiscarding] = createSignal(false);
  const [saving, setSaving] = createSignal(false);
  const [error, setError] = createSignal<AppError | null>(null);
  // Set once saved text looks like it holds a credential; the editor stays open to say so.
  const [secret, setSecret] = createSignal(false);
  let area: TextareaRenderable | undefined;

  const changed = () => text() !== props.text;
  const clearing = () => text().trim() === "" && props.text.trim() !== "";

  const save = async () => {
    if (saving()) return;
    setSaving(true);
    setError(null);
    const saved = await props.save(text());
    setSaving(false);
    if (!saved.ok) {
      setError(saved.error);
      return;
    }
    if (saved.value.secret) setSecret(true);
    else props.onClose();
  };

  const close = () => {
    if (secret() || !changed() || discarding()) {
      props.onClose();
      return;
    }
    setDiscarding(true);
  };

  useKeyboard((key) => {
    if (key.name === "escape" || (key.ctrl && key.name === "c")) {
      close();
      return;
    }
    if (secret()) return;
    if (key.ctrl && key.name === "s") {
      void save();
      return;
    }
    setDiscarding(false);
  });

  const rows = () => Math.max(MIN_ROWS, Math.min(MAX_ROWS, dimensions().height - CHROME_ROWS));

  return (
    <Dialog title={` Note on ${props.subject} `} width={dialogWidth(dimensions().width)}>
      <textarea
        ref={(element: TextareaRenderable) => {
          area = element;
        }}
        initialValue={props.text}
        focused={!secret()}
        height={rows()}
        wrapMode="word"
        placeholder="Anything worth remembering: decisions, links, what to try next."
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
      <Switch>
        <Match when={secret()}>
          <text fg={PALETTE.warning}>
            {`${props.icons === "ascii" ? "!" : "⚠"} Saved, but this looks like it holds a secret, such as a token or password. Notes are stored unencrypted; keep secrets in your keychain or password manager.`}
          </text>
          <text fg={PALETTE.textMuted}>esc close</text>
        </Match>
        <Match when={discarding()}>
          <text fg={PALETTE.warning}>Unsaved changes: esc again discards them, ctrl+s saves.</text>
        </Match>
        <Match when={true}>
          <text fg={PALETTE.textMuted}>
            {saving() ? "Saving..." : `ctrl+s ${clearing() ? "clear note" : "save"}  esc cancel`}
          </text>
        </Match>
      </Switch>
    </Dialog>
  );
}
