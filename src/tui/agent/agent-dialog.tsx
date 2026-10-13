import { useKeyboard, usePaste, useTerminalDimensions } from "@opentui/solid";
import { createMemo, createSignal, For, onCleanup, Show } from "solid-js";
import type {
  AgentEvent,
  AgentHost,
  AgentSession,
  DraftComment,
  DraftReview,
  PutBack,
} from "../../application/ports/agent";
import type { ConfirmationPrompt } from "../../domain/shared/confirmation";
import type { Workspace } from "../../domain/workspace/workspace";
import { ConfirmDialog } from "../confirm-dialog";
import { Dialog } from "../dialog";
import { eraseChar, eraseWord, pastedText } from "../query-input/edit";
import { queryActionFor } from "../query-input/keys";
import { PALETTE } from "../theme/palette";
import type { IconSet } from "../theme/status";
import { PostDialog } from "./post-dialog";
import { type TranscriptEntry, transcriptRows } from "./transcript";

export interface AgentDialogProps {
  readonly agent: AgentHost;
  /** What the conversation is about, for the title, such as "Review MOB/app#42". */
  readonly title: string;
  /** Where the agent works; null when no workspace holds the code it is asked about. */
  readonly workspace: Workspace | null;
  /** The first message, sent as the dialog opens; null has it study the workspace again. */
  readonly prompt: string | null;
  /** A branch to check out in the workspace while the agent works; null leaves it be. */
  readonly branch?: string | null;
  readonly icons: IconSet;
  readonly onClose: () => void;
  /** How the workspace was put back once the conversation closed, after a branch was checked out. */
  readonly onPutBack?: (done: PutBack) => void;
}

/** What the agent is waiting on the user for: whether it may act, or what of a review to post. */
type Waiting =
  | {
      readonly kind: "approve";
      readonly prompt: ConfirmationPrompt;
      readonly answer: (approved: boolean) => void;
      readonly decline: () => void;
    }
  | {
      readonly kind: "review";
      readonly draft: DraftReview;
      readonly answer: (chosen: readonly DraftComment[]) => void;
      readonly decline: () => void;
    };

/** The frame, the line under the transcript, the input, the keys, and the dialog's margin. */
const CHROME_ROWS = 10;

/** The end of `text` that fits in `width` columns, so what is being typed stays in view. */
function lastColumns(text: string, width: number): string {
  let kept = "";
  for (const char of Array.from(text).reverse()) {
    if (Bun.stringWidth(char + kept) > width) break;
    kept = char + kept;
  }
  return kept;
}

/**
 * A conversation with a coding agent, such as Claude Code, started on a question. What it says
 * and the tools it uses show as they happen; anything that is not a read is put to the user in a
 * confirmation first. Once it has answered, another message can be typed and sent with Enter.
 * Closing stops it.
 */
export function AgentDialog(props: AgentDialogProps) {
  const dimensions = useTerminalDimensions();
  const [entries, setEntries] = createSignal<TranscriptEntry[]>(
    props.prompt === null ? [] : [{ kind: "you", text: props.prompt }],
  );
  const [working, setWorking] = createSignal(true);
  const [ended, setEnded] = createSignal(false);
  const [cost, setCost] = createSignal<number | null>(null);
  const [draft, setDraft] = createSignal("");
  // The first row shown; null keeps the newest in view as they come.
  const [top, setTop] = createSignal<number | null>(null);
  const [approvals, setApprovals] = createSignal<readonly Waiting[]>([]);
  const add = (entry: TranscriptEntry) => setEntries((all) => [...all, entry]);
  // As when it was asked, though another agent or model is chosen meanwhile.
  const name = props.agent.name;
  const model = props.agent.model;

  const onEvent = (event: AgentEvent) => {
    switch (event.kind) {
      case "ready":
        return;
      case "text":
        add({ kind: "agent", text: event.text });
        return;
      case "tool":
        add({ kind: "tool", name: event.name, input: event.input });
        return;
      case "step":
        add({ kind: "note", text: event.text, tone: event.failed ? "error" : "muted" });
        return;
      case "turn":
        setWorking(false);
        setCost(event.costUsd);
        if (event.failed !== null) add({ kind: "note", text: event.failed, tone: "error" });
        return;
      case "exit":
        setWorking(false);
        setEnded(true);
        if (event.message !== null) add({ kind: "note", text: event.message, tone: "error" });
        return;
    }
  };

  const done = (waiting: Waiting) => setApprovals((all) => all.filter((each) => each !== waiting));
  const approve = (prompt: ConfirmationPrompt) =>
    new Promise<boolean>((resolve) => {
      const answer = (approved: boolean) => {
        done(waiting);
        resolve(approved);
      };
      const waiting: Waiting = { kind: "approve", prompt, answer, decline: () => answer(false) };
      setApprovals((all) => [...all, waiting]);
    });
  const review = (draft: DraftReview) =>
    new Promise<readonly DraftComment[]>((resolve) => {
      const answer = (chosen: readonly DraftComment[]) => {
        done(waiting);
        resolve(chosen);
      };
      const waiting: Waiting = { kind: "review", draft, answer, decline: () => answer([]) };
      setApprovals((all) => [...all, waiting]);
    });

  const session: AgentSession = props.agent.ask(
    { workspace: props.workspace, prompt: props.prompt, branch: props.branch ?? null },
    { onEvent, approve, review, putBack: (done) => props.onPutBack?.(done) },
  );
  onCleanup(() => {
    // Whatever it still waits on is declined, so it never acts after the dialog is gone.
    for (const waiting of approvals()) waiting.decline();
    session.stop();
  });

  const width = () => Math.max(20, dimensions().width - 4);
  // Inside the frame and its padding.
  const inner = () => width() - 4;
  const room = () => Math.max(3, dimensions().height - CHROME_ROWS);
  const ascii = () => props.icons === "ascii";
  const rows = createMemo(() =>
    transcriptRows(entries(), inner(), props.workspace?.path ?? null, ascii()),
  );
  const lastTop = () => Math.max(0, rows().length - room());
  const first = () => Math.min(top() ?? lastTop(), lastTop());
  const scroll = (to: number) => setTop(to >= lastTop() ? null : Math.max(0, to));

  const send = () => {
    const text = draft().trim();
    if (text === "" || working() || ended()) return;
    add({ kind: "you", text });
    setDraft("");
    setTop(null);
    setWorking(true);
    session.send(text);
  };

  useKeyboard((key) => {
    if (approvals().length > 0) return;
    if (key.ctrl && key.name === "c") {
      props.onClose();
      return;
    }
    switch (key.name) {
      case "pageup":
        scroll(first() - room());
        return;
      case "pagedown":
        scroll(first() + room());
        return;
      default:
        break;
    }
    const action = queryActionFor({ ...key, sequence: key.sequence ?? "" });
    switch (action?.kind) {
      case "close":
        props.onClose();
        return;
      case "choose":
        send();
        return;
      case "move":
        scroll(first() + action.delta);
        return;
      case "erase":
        setDraft((text) =>
          action.unit === "all" ? "" : action.unit === "word" ? eraseWord(text) : eraseChar(text),
        );
        return;
      case "type":
        setDraft((text) => text + action.text);
        return;
      default:
        return;
    }
  });
  usePaste((event) => {
    if (approvals().length === 0)
      setDraft((text) => text + pastedText(new TextDecoder().decode(event.bytes)));
  });

  const status = () => {
    const spent = cost() === null ? "" : `$${(cost() ?? 0).toFixed(2)}`;
    const state = ended()
      ? `${name} has stopped`
      : working()
        ? `${name} is working${ascii() ? "..." : "…"}`
        : "";
    const more = first() < lastTop() ? `  ${first() + room()}/${rows().length}` : "";
    return { state, right: `${spent}${more}` };
  };
  const input = () => {
    if (ended()) return { text: "", placeholder: "" };
    const typed = draft();
    const cursor = ascii() ? "_" : "▏";
    const shown = lastColumns(`${typed}${cursor}`, inner() - 2);
    return typed === "" && !working()
      ? { text: cursor, placeholder: ` Ask ${name} more` }
      : { text: shown, placeholder: "" };
  };

  return (
    <>
      <Dialog
        title={` ${model === null ? name : `${name} ${model}`} · ${props.title} `}
        width={width()}
      >
        <box height={room()} flexDirection="column">
          <For each={rows().slice(first(), first() + room())}>
            {(row) => <text fg={PALETTE[row.tone]}>{row.text === "" ? " " : row.text}</text>}
          </For>
        </box>
        <text>
          <span style={{ fg: working() ? PALETTE.busy : PALETTE.textMuted }}>{status().state}</span>
          <span style={{ fg: PALETTE.textMuted }}>
            {" ".repeat(
              Math.max(
                1,
                inner() - Bun.stringWidth(status().state) - Bun.stringWidth(status().right),
              ),
            )}
            {status().right}
          </span>
        </text>
        <text>
          <span style={{ fg: PALETTE.accentSecondary }}>{ascii() ? "> " : "› "}</span>
          <span style={{ fg: PALETTE.text }}>{input().text}</span>
          <span style={{ fg: PALETTE.textDim }}>{input().placeholder}</span>
        </text>
        <text fg={PALETTE.textMuted}>
          {`${ended() ? "" : "enter send  "}${ascii() ? "pgup/pgdn" : "⇞⇟"} scroll  esc close`}
        </text>
      </Dialog>
      {/* Keyed: each question gets a dialog of its own, as one answers only once. */}
      <Show when={approvals()[0]} keyed>
        {(waiting: Waiting) =>
          waiting.kind === "approve" ? (
            <ConfirmDialog prompt={waiting.prompt} icons={props.icons} onAnswer={waiting.answer} />
          ) : (
            <PostDialog draft={waiting.draft} icons={props.icons} onAnswer={waiting.answer} />
          )
        }
      </Show>
    </>
  );
}
