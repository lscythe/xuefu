import { useKeyboard, useTerminalDimensions } from "@opentui/solid";
import { createMemo, createSignal, For, onCleanup, Show } from "solid-js";
import type { AppError } from "../../../application/errors";
import type { Result } from "../../../domain/shared/result";
import type { Timestamp } from "../../../domain/shared/time";
import { wallClock } from "../../../domain/shared/wall-clock";
import { Dialog, dialogWidth } from "../../../tui/dialog";
import { truncateToWidth } from "../../../tui/shell/tab-labels";
import { PALETTE, type PaletteToken } from "../../../tui/theme/palette";
import type { IconSet } from "../../../tui/theme/status";
import { wrapText } from "../../../tui/wrap";
import { type BuildSummary, type PullRequest, pullRequestRef } from "../domain/pull-request";
import { reviewBadge } from "./pr-rows";

export interface PullRequestDialogProps {
  readonly pull: PullRequest;
  /** Reads the builds of its latest commit; stopped if the dialog closes first. */
  readonly builds: (signal: AbortSignal) => Promise<Result<BuildSummary, AppError>>;
  readonly icons: IconSet;
  /** The time zone dates are shown in; the host's unless given. */
  readonly timeZone?: string | undefined;
  readonly onClose: () => void;
}

/** Rows the dialog keeps for its frame and the lines around the details. */
const CHROME_ROWS = 6;
/** Most rows a description takes before it scrolls, so the dialog stays a dialog. */
const MAX_DESCRIPTION_ROWS = 14;
const LABEL_WIDTH = 11;

/** Builds as a few words, coloured by the worst of them. */
function buildsLine(builds: BuildSummary): { readonly text: string; readonly tone: PaletteToken } {
  const parts = [
    builds.successful > 0 ? `${builds.successful} passed` : null,
    builds.failed > 0 ? `${builds.failed} failed` : null,
    builds.inProgress > 0 ? `${builds.inProgress} running` : null,
  ].filter((part) => part !== null);
  return {
    text: parts.length === 0 ? "none" : parts.join(", "),
    tone:
      builds.failed > 0
        ? "error"
        : builds.inProgress > 0
          ? "busy"
          : builds.successful > 0
            ? "success"
            : "textMuted",
  };
}

/**
 * A pull request's details, its builds read as it opens, and its description, which the arrows
 * scroll. Esc closes.
 */
export function PullRequestDialog(props: PullRequestDialogProps) {
  const dimensions = useTerminalDimensions();
  const [builds, setBuilds] = createSignal<Result<BuildSummary, AppError> | null>(null);
  const [top, setTop] = createSignal(0);
  const reading = new AbortController();
  onCleanup(() => reading.abort());
  void props.builds(reading.signal).then((result) => {
    if (!reading.signal.aborted) setBuilds(result);
  });

  const width = () => dialogWidth(dimensions().width);
  // Inside the frame and its padding.
  const inner = () => width() - 4;
  const when = (at: number) => {
    const clock = wallClock(at as Timestamp, props.timeZone);
    return `${clock.date} ${clock.time}`;
  };

  const title = createMemo(() => wrapText(props.pull.title, inner()));
  const details = createMemo((): [string, string, PaletteToken][] => {
    const pull = props.pull;
    const read = builds();
    const built =
      read === null
        ? { text: "reading...", tone: "textMuted" as const }
        : read.ok
          ? buildsLine(read.value)
          : { text: `could not be read: ${read.error.message}`, tone: "warning" as const };
    const review = reviewBadge(pull);
    return [
      ["Branches", `${pull.from} → ${pull.to}`, "text"],
      ["Author", pull.author, "text"],
      ["Reviews", review.text, review.tone],
      ...pull.reviewers.map((reviewer): [string, string, PaletteToken] => [
        "",
        `${reviewer.name}${reviewer.status === "unapproved" ? "" : `, ${reviewer.status.replace("-", " ")}`}`,
        reviewer.status === "approved"
          ? "success"
          : reviewer.status === "needs-work"
            ? "warning"
            : "textMuted",
      ]),
      ["Builds", built.text, built.tone],
      [
        "Comments",
        pull.openTodos === 0 ? String(pull.comments) : `${pull.comments}, ${pull.openTodos} to do`,
        pull.openTodos === 0 ? "text" : "warning",
      ],
      ...(pull.conflicted === null
        ? []
        : [
            [
              "Merge",
              pull.conflicted ? "conflicts" : "clean",
              pull.conflicted ? "error" : "success",
            ] as [string, string, PaletteToken],
          ]),
      ["Updated", when(pull.updated), "text"],
    ];
  });
  const description = createMemo(() => {
    const text = props.pull.description?.trim() ?? "";
    return text === "" ? [] : wrapText(text, inner());
  });
  const room = () =>
    Math.max(
      3,
      Math.min(
        MAX_DESCRIPTION_ROWS,
        dimensions().height - 4 - CHROME_ROWS - title().length - details().length,
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
  const footer = () => {
    const more = description().length > room();
    const at = more
      ? `  ${Math.min(description().length, top() + room())}/${description().length}`
      : "";
    return `${more ? (ascii() ? "j/k scroll  " : "↑↓ scroll  ") : ""}esc close${at}`;
  };

  return (
    <Dialog title={` ${pullRequestRef(props.pull)} `} width={width()}>
      <For each={title()}>
        {(line) => (
          <text fg={PALETTE.text}>
            <b>{line}</b>
          </text>
        )}
      </For>
      <text> </text>
      <For each={details()}>
        {([label, value, tone]) => (
          <text>
            <span style={{ fg: PALETTE.textMuted }}>{label.padEnd(LABEL_WIDTH)}</span>
            <span style={{ fg: PALETTE[tone] }}>
              {truncateToWidth(value, inner() - LABEL_WIDTH)}
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
      <text> </text>
      <text fg={PALETTE.textMuted}>{truncateToWidth(props.pull.url, inner())}</text>
      <text fg={PALETTE.textMuted}>{footer()}</text>
    </Dialog>
  );
}
