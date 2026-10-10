import type { TextareaRenderable } from "@opentui/core";
import { useKeyboard, useTerminalDimensions } from "@opentui/solid";
import { type Accessor, createSignal, onCleanup, Show } from "solid-js";
import type { AppError } from "../../../application/errors";
import type { Result } from "../../../domain/shared/result";
import { Dialog, dialogWidth } from "../../../tui/dialog";
import { ErrorLine } from "../../../tui/error-line";
import { PALETTE } from "../../../tui/theme/palette";
import type { IconSet } from "../../../tui/theme/status";
import type { Committed } from "../application/actions";
import { commitMessage } from "../domain/commit";

export interface CommitEditorProps {
  /** Where the commit goes: the branch, or null on a detached HEAD. */
  readonly branch: string | null;
  readonly staged: number;
  /** The message as left last time; empty for a fresh one. */
  readonly draft: string;
  readonly icons: IconSet;
  readonly commit: (message: string, signal: AbortSignal) => Promise<Result<Committed, AppError>>;
  /** Called with the message as it stands, so closing never loses it. */
  readonly onDraft: (text: string) => void;
  /** Closes the editor, with the commit when one was made. */
  readonly onClose: (committed: Committed | null) => void;
}

const ROWS = 6;
/** Git's own advice: a summary longer than this is cut short in one-line logs. */
const SUMMARY_LIMIT = 72;

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/**
 * A commit message in a text area: Ctrl+S commits what is staged, Esc closes. The message is kept
 * for next time until a commit is made, so closing never loses it. While the commit runs, its
 * hooks included, Esc stops it.
 */
export function CommitEditor(props: CommitEditorProps) {
  const dimensions = useTerminalDimensions();
  const [text, setText] = createSignal(props.draft);
  const [running, setRunning] = createSignal<AbortController | null>(null);
  const [error, setError] = createSignal<AppError | null>(null);
  let area: TextareaRenderable | undefined;

  onCleanup(() => running()?.abort());

  const summary = () => text().trimStart().split("\n", 1)[0]?.trimEnd() ?? "";

  const commit = async () => {
    if (running() !== null) return;
    const message = commitMessage(text());
    if (!message.ok) {
      setError(message.error);
      return;
    }
    const controller = new AbortController();
    setRunning(controller);
    setError(null);
    const made = await props.commit(text(), controller.signal);
    setRunning(null);
    if (made.ok) props.onClose(made.value);
    else setError(made.error);
  };

  useKeyboard((key) => {
    if (key.name === "escape" || (key.ctrl && key.name === "c")) {
      const stopping = running();
      if (stopping !== null) {
        stopping.abort();
        return;
      }
      props.onDraft(text());
      props.onClose(null);
      return;
    }
    if (key.ctrl && key.name === "s") void commit();
  });

  const footer = () => {
    if (running() !== null) return "Committing... hooks may take a while; esc stops it";
    return `ctrl+s commit ${plural(props.staged, "file", "files")}  esc close`;
  };

  return (
    <Dialog
      title={props.branch === null ? " Commit " : ` Commit on ${props.branch} `}
      width={dialogWidth(dimensions().width)}
    >
      <textarea
        ref={(element: TextareaRenderable) => {
          area = element;
        }}
        initialValue={props.draft}
        focused={running() === null}
        height={ROWS}
        wrapMode="word"
        placeholder="A summary on the first line; details after a blank line."
        placeholderColor={PALETTE.textDim}
        backgroundColor={PALETTE.panelBg}
        focusedBackgroundColor={PALETTE.panelBg}
        textColor={PALETTE.text}
        focusedTextColor={PALETTE.text}
        cursorColor={PALETTE.cursor}
        selectionBg={PALETTE.selectionBg}
        onContentChange={() => setText(area?.plainText ?? "")}
      />
      <Show when={summary().length > SUMMARY_LIMIT}>
        <text fg={PALETTE.warning}>
          {`Summary is ${summary().length} characters; up to ${SUMMARY_LIMIT} reads best in logs.`}
        </text>
      </Show>
      <Show when={error()}>
        {(shown: Accessor<AppError>) => (
          <ErrorLine error={shown()} ascii={props.icons === "ascii"} />
        )}
      </Show>
      <text fg={PALETTE.textMuted}>{footer()}</text>
    </Dialog>
  );
}
