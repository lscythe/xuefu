import { useKeyboard, usePaste, useTerminalDimensions } from "@opentui/solid";
import { createMemo, createSignal, For, onCleanup, Show } from "solid-js";
import type { AgentEvent, AgentHost, AgentSession } from "../../application/ports/agent";
import type { ConfirmationPrompt } from "../../domain/shared/confirmation";
import type { AbsolutePath } from "../../domain/shared/path";
import { ConfirmDialog } from "../confirm-dialog";
import { Dialog } from "../dialog";
import { errorText } from "../error-line";
import { eraseChar, eraseWord, pastedText } from "../query-input/edit";
import { queryActionFor } from "../query-input/keys";
import { PALETTE } from "../theme/palette";
import type { IconSet } from "../theme/status";
import { type TranscriptEntry, transcriptRows } from "./transcript";

export interface AgentDialogProps {
  readonly agent: AgentHost;
  /** What the conversation is about, for the title, such as "Review MOB/app#42". */
  readonly title: string;
  /** Where the agent works: the folder of the workspace in front. */
  readonly cwd: AbsolutePath;
  /** The first message, sent as the dialog opens. */
  readonly prompt: string;
  readonly icons: IconSet;
  readonly onClose: () => void;
}

/** A question the agent is waiting on the user to answer. */
interface Approval {
  readonly prompt: ConfirmationPrompt;
  readonly answer: (approved: boolean) => void;
}

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
  const [entries, setEntries] = createSignal<TranscriptEntry[]>([
    { kind: "you", text: props.prompt },
  ]);
  const [working, setWorking] = createSignal(true);
  const [ended, setEnded] = createSignal(false);
  const [cost, setCost] = createSignal<number | null>(null);
  const [draft, setDraft] = createSignal("");
  // The first row shown; null keeps the newest in view as they come.
  const [top, setTop] = createSignal<number | null>(null);
  const [approvals, setApprovals] = createSignal<readonly Approval[]>([]);
  const add = (entry: TranscriptEntry) => setEntries((all) => [...all, entry]);
  const name = props.agent.name;

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

  const approve = (prompt: ConfirmationPrompt) =>
    new Promise<boolean>((resolve) => {
      const approval: Approval = {
        prompt,
        answer: (approved) => {
          setApprovals((all) => all.filter((each) => each !== approval));
          resolve(approved);
        },
      };
      setApprovals((all) => [...all, approval]);
    });

  let session: AgentSession | null = null;
  const started = props.agent.ask({ cwd: props.cwd, prompt: props.prompt }, { onEvent, approve });
  if (started.ok) {
    session = started.value;
  } else {
    setWorking(false);
    setEnded(true);
    add({ kind: "note", text: errorText(started.error), tone: "error" });
  }
  onCleanup(() => {
    // Whatever it still waits on is declined, so it never acts after the dialog is gone.
    for (const approval of approvals()) approval.answer(false);
    session?.stop();
  });

  const width = () => Math.max(20, dimensions().width - 4);
  // Inside the frame and its padding.
  const inner = () => width() - 4;
  const room = () => Math.max(3, dimensions().height - CHROME_ROWS);
  const ascii = () => props.icons === "ascii";
  const rows = createMemo(() => transcriptRows(entries(), inner(), props.cwd, ascii()));
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
    session?.send(text);
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
      <Dialog title={` ${name} · ${props.title} `} width={width()}>
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
        {(approval: Approval) => (
          <ConfirmDialog prompt={approval.prompt} icons={props.icons} onAnswer={approval.answer} />
        )}
      </Show>
    </>
  );
}
