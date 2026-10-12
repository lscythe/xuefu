import { useKeyboard, useTerminalDimensions } from "@opentui/solid";
import { createMemo, createSignal, For } from "solid-js";
import type { DraftComment, DraftReview } from "../../application/ports/agent";
import { Dialog } from "../dialog";
import { PALETTE } from "../theme/palette";
import type { IconSet } from "../theme/status";
import { postRows } from "./post-rows";

export interface PostDialogProps {
  readonly draft: DraftReview;
  readonly icons: IconSet;
  /** Called once, with the comments to post; none when the user posts nothing. */
  readonly onAnswer: (chosen: readonly DraftComment[]) => void;
}

/** The frame, the blank line and the keys, and the dialog's margin. */
const CHROME_ROWS = 8;

/**
 * The review the user and the agent settled on, before it is posted: every comment, where it goes
 * and the code it suggests. All are chosen to start with; Space leaves one out or puts it back, a
 * does so for all, Enter posts those chosen, and Esc posts none.
 */
export function PostDialog(props: PostDialogProps) {
  const dimensions = useTerminalDimensions();
  const count = props.draft.comments.length;
  const [chosen, setChosen] = createSignal<ReadonlySet<number>>(
    new Set(props.draft.comments.map((_, index) => index)),
  );
  const [cursor, setCursor] = createSignal(0);
  let answered = false;

  const answer = (post: boolean) => {
    if (answered) return;
    answered = true;
    props.onAnswer(post ? props.draft.comments.filter((_, index) => chosen().has(index)) : []);
  };
  const toggle = (index: number) =>
    setChosen((all) => {
      const next = new Set(all);
      if (!next.delete(index)) next.add(index);
      return next;
    });

  useKeyboard((key) => {
    if (key.name === "escape" || (key.ctrl && key.name === "c")) answer(false);
    else if (key.name === "return") answer(true);
    else if (key.name === "up" || key.name === "k") setCursor((at) => Math.max(0, at - 1));
    else if (key.name === "down" || key.name === "j")
      setCursor((at) => Math.min(count - 1, at + 1));
    else if (key.name === "space") toggle(cursor());
    else if (key.name === "a") {
      setChosen(
        new Set(chosen().size === count ? [] : props.draft.comments.map((_, index) => index)),
      );
    }
  });

  const width = () => Math.max(20, dimensions().width - 4);
  // Inside the frame and its padding.
  const inner = () => width() - 4;
  const room = () => Math.max(3, dimensions().height - CHROME_ROWS);
  const drawn = createMemo(() =>
    postRows(props.draft.comments, chosen(), cursor(), inner(), props.icons === "ascii"),
  );
  // The first row shown: as late as keeps the comment under the cursor wholly in view.
  const first = createMemo(() => {
    const { rows, starts } = drawn();
    const start = starts[cursor()] ?? 0;
    const end = (starts[cursor() + 1] ?? rows.length + 1) - 1;
    const last = Math.max(0, rows.length - room());
    return Math.min(last, start, Math.max(0, end - room()));
  });
  const height = () => Math.min(room(), drawn().rows.length);
  const posting = () => chosen().size;

  return (
    <Dialog title={` Post on ${props.draft.pullRequest} `} width={width()}>
      <box height={height()} flexDirection="column">
        <For each={drawn().rows.slice(first(), first() + height())}>
          {(row) => (
            // The comment under the cursor is lit the whole width, as a list's chosen row is.
            <text fg={PALETTE[row.tone]} {...(row.current ? { bg: PALETTE.selectionBg } : {})}>
              {row.current
                ? row.text + " ".repeat(Math.max(0, inner() - Bun.stringWidth(row.text)))
                : row.text === ""
                  ? " "
                  : row.text}
            </text>
          )}
        </For>
      </box>
      <text> </text>
      <text>
        <span style={{ fg: PALETTE.accentTertiary }}>space</span>
        <span style={{ fg: PALETTE.text }}>{" choose  "}</span>
        <span style={{ fg: PALETTE.accentTertiary }}>a</span>
        <span style={{ fg: PALETTE.text }}>{" all  "}</span>
        <span style={{ fg: PALETTE.accentTertiary }}>enter</span>
        <span style={{ fg: PALETTE.text }}>
          {` post ${posting()} of ${count}${count === 1 ? " comment" : " comments"}  `}
        </span>
        <span style={{ fg: PALETTE.accentTertiary }}>esc</span>
        <span style={{ fg: PALETTE.text }}>{" post none"}</span>
      </text>
    </Dialog>
  );
}
