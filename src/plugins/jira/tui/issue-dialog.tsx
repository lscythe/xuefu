import { useKeyboard, useTerminalDimensions } from "@opentui/solid";
import {
  type Accessor,
  createMemo,
  createSignal,
  For,
  Match,
  onCleanup,
  Show,
  Switch,
} from "solid-js";
import type { AppError } from "../../../application/errors";
import type { Result } from "../../../domain/shared/result";
import type { Timestamp } from "../../../domain/shared/time";
import { wallClock } from "../../../domain/shared/wall-clock";
import { Dialog, dialogWidth } from "../../../tui/dialog";
import { ErrorLine } from "../../../tui/error-line";
import { truncateToWidth } from "../../../tui/shell/tab-labels";
import { PALETTE } from "../../../tui/theme/palette";
import type { IconSet } from "../../../tui/theme/status";
import { wrapText } from "../../../tui/wrap";
import type { JiraIssue } from "../domain/issue";
import { categoryTone } from "./issue-rows";

export interface IssueDialogProps {
  readonly issueKey: string;
  /** Reads the issue with its description; stopped if the dialog closes first. */
  readonly load: (signal: AbortSignal) => Promise<Result<JiraIssue, AppError>>;
  readonly url: string;
  readonly icons: IconSet;
  /** The time zone dates are shown in; the host's unless given. */
  readonly timeZone?: string | undefined;
  readonly onClose: () => void;
}

/** Rows the dialog keeps for its frame, the summary and details, and the lines around them. */
const CHROME_ROWS = 6;
/** Most rows a description takes before it scrolls, so the dialog stays a dialog. */
const MAX_DESCRIPTION_ROWS = 16;

/**
 * An issue's details and description, read when it opens. The arrows scroll a long description;
 * Esc closes.
 */
export function IssueDialog(props: IssueDialogProps) {
  const dimensions = useTerminalDimensions();
  const [loaded, setLoaded] = createSignal<Result<JiraIssue, AppError> | null>(null);
  const [top, setTop] = createSignal(0);
  const reading = new AbortController();
  onCleanup(() => reading.abort());
  void props.load(reading.signal).then((result) => {
    if (!reading.signal.aborted) setLoaded(result);
  });

  const issue = () => {
    const result = loaded();
    return result?.ok === true ? result.value : null;
  };
  const failure = () => {
    const result = loaded();
    return result?.ok === false ? result.error : null;
  };

  const width = () => dialogWidth(dimensions().width);
  // Inside the frame and its padding.
  const inner = () => width() - 4;
  const when = (at: number) => {
    const clock = wallClock(at as Timestamp, props.timeZone);
    return `${clock.date} ${clock.time}`;
  };

  const summary = createMemo(() => {
    const shown = issue();
    return shown === null ? [] : wrapText(shown.summary, inner());
  });
  const details = createMemo(() => {
    const shown = issue();
    if (shown === null) return [];
    const rows: [string, string | null][] = [
      ["Status", shown.status.name],
      ["Type", shown.type],
      ["Priority", shown.priority],
      ["Assignee", shown.assignee ?? "Unassigned"],
      ["Reporter", shown.reporter],
      ["Updated", when(shown.updated)],
    ];
    return rows.filter((row): row is [string, string] => row[1] !== null);
  });
  const description = createMemo(() => {
    const text = issue()?.description?.trim() ?? "";
    return text === "" ? [] : wrapText(text, inner());
  });
  const room = () =>
    Math.max(
      3,
      Math.min(
        MAX_DESCRIPTION_ROWS,
        dimensions().height - 4 - CHROME_ROWS - summary().length - details().length,
      ),
    );
  const lastTop = () => Math.max(0, description().length - room());
  const scroll = (to: number) => setTop(Math.max(0, Math.min(lastTop(), to)));

  useKeyboard((key) => {
    switch (key.name) {
      case "escape":
      case "q":
        props.onClose();
        return;
      case "up":
      case "k":
        scroll(top() - 1);
        return;
      case "down":
      case "j":
        scroll(top() + 1);
        return;
      case "pageup":
        scroll(top() - room());
        return;
      case "pagedown":
      case "space":
        scroll(top() + room());
        return;
      case "home":
        scroll(0);
        return;
      case "end":
        scroll(lastTop());
        return;
      default:
        return;
    }
  });

  const ascii = () => props.icons === "ascii";
  const labelWidth = 10;
  const footer = () => {
    const more = description().length > room();
    const at = more
      ? `  ${Math.min(description().length, top() + room())}/${description().length}`
      : "";
    return `${more ? (ascii() ? "j/k scroll  " : "↑↓ scroll  ") : ""}esc close${at}`;
  };

  return (
    <Dialog title={` ${props.issueKey} `} width={width()}>
      <Switch>
        <Match when={loaded() === null}>
          <text fg={PALETTE.textMuted}>{`Reading ${props.issueKey}...`}</text>
        </Match>
        <Match when={failure()}>
          {(error: Accessor<AppError>) => (
            <>
              <ErrorLine error={error()} ascii={ascii()} />
              <Show when={error().hint}>
                {(hint: Accessor<string>) => <text fg={PALETTE.textMuted}>{hint()}</text>}
              </Show>
            </>
          )}
        </Match>
        <Match when={issue()}>
          {(shown: Accessor<JiraIssue>) => (
            <>
              <For each={summary()}>
                {(line) => (
                  <text fg={PALETTE.text}>
                    <b>{line}</b>
                  </text>
                )}
              </For>
              <text> </text>
              <For each={details()}>
                {([label, value]) => (
                  <text>
                    <span style={{ fg: PALETTE.textMuted }}>{label.padEnd(labelWidth)}</span>
                    <span
                      style={{
                        fg:
                          label === "Status"
                            ? PALETTE[categoryTone(shown().status.category)]
                            : PALETTE.text,
                      }}
                    >
                      {truncateToWidth(value, inner() - labelWidth)}
                    </span>
                  </text>
                )}
              </For>
              <text> </text>
              <Show
                when={description().length > 0}
                fallback={<text fg={PALETTE.textMuted}>No description.</text>}
              >
                <box height={Math.min(room(), description().length)} flexDirection="column">
                  <For each={description().slice(top(), top() + room())}>
                    {(line) => <text fg={PALETTE.text}>{line === "" ? " " : line}</text>}
                  </For>
                </box>
              </Show>
            </>
          )}
        </Match>
      </Switch>
      <text> </text>
      <text fg={PALETTE.textMuted}>{truncateToWidth(props.url, inner())}</text>
      <text fg={PALETTE.textMuted}>{footer()}</text>
    </Dialog>
  );
}
