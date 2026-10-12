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
import type { Timestamp } from "../../../domain/shared/time";
import { wallClock } from "../../../domain/shared/wall-clock";
import { createAsking } from "../../../tui/asking";
import { type Banner, BannerLine } from "../../../tui/banner-line";
import { Dialog } from "../../../tui/dialog";
import { ErrorLine } from "../../../tui/error-line";
import { scrollOffset } from "../../../tui/list-navigation";
import { truncateToWidth } from "../../../tui/shell/tab-labels";
import { PALETTE } from "../../../tui/theme/palette";
import type { IconSet } from "../../../tui/theme/status";
import { commentInput, type PrChanges } from "../application/actions";
import { anchorText, type CommentDraft, type PullRequestComment } from "../domain/comment";
import { type DiffFile, parseDiff } from "../domain/diff";
import { type PullRequest, pullRequestRef } from "../domain/pull-request";
import { CommentEditor } from "./comment-editor";
import { commentIndent, type ReviewRow, reviewRows, selectable } from "./review-rows";

export interface ReviewDialogProps {
  readonly pull: PullRequest;
  readonly changes: PrChanges;
  readonly icons: IconSet;
  /** The time zone dates are shown in; the host's unless given. */
  readonly timeZone?: string | undefined;
  readonly onClose: () => void;
}

/** What a comment being written goes on, and what the editor's title says of it. */
interface Writing {
  readonly on: string;
  readonly draft: Omit<CommentDraft, "text">;
  /** Keeps its text apart from other comments' while it is not posted. */
  readonly key: string;
}

/** Rows the dialog keeps for its frame, title, banner and key bar. */
const CHROME_ROWS = 7;
/** Columns before a line's code: its numbers before and after, and its sign. */
const GUTTER = 12;

const LETTERS: Readonly<Record<DiffFile["change"], string>> = {
  added: "A",
  deleted: "D",
  modified: "M",
  renamed: "R",
  copied: "C",
};

const number = (value: number | null) => (value === null ? "" : String(value)).padStart(4);

/**
 * Reviewing a pull request: its diff, file by file, with each comment thread under the line it is
 * on. The arrows move over lines and comments; `c` comments on the line under the cursor or replies
 * to the comment, `C` comments on the pull request, each asking first; `n` and `p` go to the next
 * and previous file; `r` reads it all again. Esc closes.
 */
export function ReviewDialog(props: ReviewDialogProps) {
  const { client, invoke, actions } = props.changes;
  const dimensions = useTerminalDimensions();
  const [files, setFiles] = createSignal<DiffFile[] | null>(null);
  const [threads, setThreads] = createSignal<PullRequestComment[]>([]);
  const [failure, setFailure] = createSignal<AppError | null>(null);
  const [cursor, setCursor] = createSignal(0);
  const [banner, setBanner] = createSignal<Banner | null>(null);
  const [writing, setWriting] = createSignal<Writing | null>(null);
  const drafts = new Map<string, string>();
  const { asking, confirmed, AskingDialog } = createAsking();

  const reading = new AbortController();
  onCleanup(() => reading.abort());
  const { repository, id } = props.pull;
  const readComments = async () => {
    const read = await client.comments(repository, id, reading.signal);
    if (reading.signal.aborted) return;
    if (read.ok) setThreads(read.value);
    else setBanner({ kind: "warning", text: `Could not read the comments: ${read.error.message}` });
  };
  const readAll = async () => {
    const [diff] = await Promise.all([client.diff(repository, id, reading.signal), readComments()]);
    if (reading.signal.aborted) return;
    if (diff.ok) setFiles(parseDiff(diff.value));
    else setFailure(diff.error);
  };
  void readAll();

  const width = () => Math.max(40, dimensions().width - 4);
  const inner = () => width() - 4;
  const visible = () =>
    Math.max(3, dimensions().height - CHROME_ROWS - (banner() === null ? 0 : 1));
  const rows = createMemo(() => reviewRows(files() ?? [], threads(), inner()));
  /** The cursor, on the nearest row it can stop on. */
  const at = createMemo(() => {
    const all = rows();
    for (let index = Math.min(cursor(), all.length - 1); index >= 0; index--) {
      const row = all[index];
      if (row !== undefined && selectable(row)) return index;
    }
    return all.findIndex(selectable);
  });
  const chosen = () => rows()[at()];
  const top = () => scrollOffset(Math.max(0, at()), rows().length, visible());
  /** The rows in view, made anew as the cursor moves, so the one under it is drawn as chosen. */
  const drawn = () =>
    rows()
      .slice(top(), top() + visible())
      .map((row, index) => ({ row, selected: top() + index === at() }));

  /**
   * Moves `delta` rows, to the first row from there the cursor can stop on, or past the ends, to
   * the last one before.
   */
  const move = (delta: number) => {
    const all = rows();
    const target = Math.max(0, Math.min(all.length - 1, at() + delta));
    const step = delta < 0 ? -1 : 1;
    for (const direction of [step, -step]) {
      for (let index = target; index >= 0 && index < all.length; index += direction) {
        if (selectable(all[index] as ReviewRow)) {
          setCursor(index);
          return;
        }
      }
    }
  };
  /** Moves to the first line of the next or previous file. */
  const toFile = (step: 1 | -1) => {
    const all = rows();
    const heading = (index: number) => all[index]?.kind === "file";
    let index = at() + step;
    // Going back starts past the heading of the file the cursor is in.
    if (step === -1) {
      while (index >= 0 && !heading(index)) index -= 1;
      index -= 1;
    }
    for (; index >= 0 && index < all.length; index += step) {
      if (heading(index)) {
        firstFrom(index);
        return;
      }
    }
  };
  /** Moves to the first row from `index` on that the cursor can stop on. */
  const firstFrom = (index: number) => {
    const found = rows().findIndex((row, at) => at >= index && selectable(row));
    if (found !== -1) setCursor(found);
  };

  const when = (time: number) => {
    const clock = wallClock(time as Timestamp, props.timeZone);
    return `${clock.date} ${clock.time}`;
  };

  /** Opens the editor for a comment on the line or comment under the cursor, or on the whole. */
  const write = (whole: boolean) => {
    const row = chosen();
    if (whole || row === undefined || !selectable(row)) {
      setWriting({ on: "the pull request", draft: { anchor: null, replyTo: null }, key: "pr" });
    } else if (row.kind === "line") {
      setWriting({
        on: anchorText(row.anchor),
        draft: { anchor: row.anchor, replyTo: null },
        key: anchorText(row.anchor),
      });
    } else {
      setWriting({
        on: `a reply to ${row.comment.author}`,
        draft: { anchor: null, replyTo: row.comment.id },
        key: `#${row.comment.id}`,
      });
    }
  };

  const post = async (shown: Writing, text: string) => {
    const posted = await confirmed((options) =>
      invoke(actions.comment, commentInput(props.pull, { ...shown.draft, text }), options),
    );
    if (posted?.ok === true) {
      drafts.delete(shown.key);
      setBanner({ kind: "success", text: `Posted #${posted.value.id} on ${shown.on}.` });
      void readComments();
    }
    return posted;
  };

  useKeyboard((key) => {
    if (writing() !== null || asking()) return;
    switch (key.name) {
      case "escape":
      case "q":
        props.onClose();
        return;
      case "up":
      case "k":
        move(-1);
        return;
      case "down":
      case "j":
        move(1);
        return;
      case "pageup":
        move(-visible());
        return;
      case "pagedown":
      case "space":
        move(visible());
        return;
      case "home":
        firstFrom(0);
        return;
      case "end":
        // The cursor settles on the nearest row before it that it can stop on.
        setCursor(rows().length - 1);
        return;
      case "n":
        toFile(1);
        return;
      case "p":
        toFile(-1);
        return;
      case "c":
        if (files() === null) return;
        // The editor takes focus at once; without this the "c" would be typed into it.
        key.preventDefault();
        write(key.shift);
        return;
      case "r":
        setBanner(null);
        void readAll();
        return;
      default:
        return;
    }
  });

  const ascii = () => props.icons === "ascii";
  const keys = () => {
    const row = chosen();
    const comment = row?.kind === "comment" ? "c reply" : "c comment";
    return `${ascii() ? "j/k" : "↑↓"} move  n/p file  ${comment}  C on the PR  r refresh  esc close`;
  };

  const drawRow = (row: ReviewRow, selected: boolean) => {
    const bg = selected ? PALETTE.selectionBg : PALETTE.panelBg;
    switch (row.kind) {
      case "heading":
        return (
          <text fg={PALETTE.accentTertiary} flexShrink={0}>
            <b>{truncateToWidth(row.text, inner())}</b>
          </text>
        );
      case "file": {
        const { file } = row;
        const path =
          file.change === "renamed" || file.change === "copied"
            ? `${file.from} → ${file.to}`
            : (file.to ?? file.from ?? "");
        const counts = file.binary ? "binary" : `+${file.added} -${file.removed}`;
        return (
          <text flexShrink={0}>
            <span style={{ fg: PALETTE.accentTertiary }}>{`${LETTERS[file.change]} `}</span>
            <span style={{ fg: PALETTE.accentSecondary }}>
              <b>{truncateToWidth(path, inner() - counts.length - 4)}</b>
            </span>
            <span style={{ fg: PALETTE.textMuted }}>{`  ${counts}`}</span>
          </text>
        );
      }
      case "hunk":
        return (
          <text fg={PALETTE.textMuted} flexShrink={0}>
            {truncateToWidth(row.header, inner())}
          </text>
        );
      case "line": {
        const { line } = row;
        const sign = line.kind === "added" ? "+" : line.kind === "removed" ? "-" : " ";
        const tone =
          line.kind === "added"
            ? PALETTE.success
            : line.kind === "removed"
              ? PALETTE.error
              : PALETTE.text;
        const code = truncateToWidth(line.text.replace(/\t/g, "  "), inner() - GUTTER);
        return (
          <text flexShrink={0}>
            <span
              style={{ fg: PALETTE.textMuted, bg }}
            >{`${number(line.old)} ${number(line.new)} `}</span>
            <span style={{ fg: tone, bg }}>
              {`${sign} ${code}`.padEnd(selected ? inner() - GUTTER + 2 : 0)}
            </span>
          </text>
        );
      }
      case "comment": {
        const { comment } = row;
        const marks = [
          comment.todo === "open" ? "to do" : comment.todo === "done" ? "done" : null,
          comment.resolved ? "resolved" : null,
          comment.anchor?.outdated === true ? `was on ${anchorText(comment.anchor)}` : null,
        ].filter((mark) => mark !== null);
        const head = [comment.author, when(comment.created), ...marks].join(" · ");
        const pad = " ".repeat(commentIndent(row.depth) - 2);
        return (
          <text flexShrink={0}>
            <span
              style={{ fg: PALETTE.accentSpectral, bg }}
            >{`${pad}${row.depth === 0 ? "▍" : "↳"} `}</span>
            <span
              style={{
                fg: comment.todo === "open" ? PALETTE.warning : PALETTE.accentSecondary,
                bg,
              }}
            >
              {truncateToWidth(head, inner() - pad.length - 2).padEnd(
                selected ? inner() - pad.length - 2 : 0,
              )}
            </span>
          </text>
        );
      }
      case "text":
        return (
          <text fg={PALETTE.text} flexShrink={0}>
            {`${" ".repeat(commentIndent(row.depth))}${row.text}` || " "}
          </text>
        );
      case "blank":
        return <text flexShrink={0}> </text>;
      default:
        return null;
    }
  };

  return (
    <>
      <Dialog title={` ${pullRequestRef(props.pull)} · ${props.pull.title} `} width={width()}>
        <Show when={banner()}>
          {(line: Accessor<Banner>) => (
            <BannerLine banner={line()} width={inner()} icons={props.icons} />
          )}
        </Show>
        <box height={visible()} flexDirection="column">
          <Switch>
            <Match when={failure()}>
              {(error: Accessor<AppError>) => <ErrorLine error={error()} ascii={ascii()} />}
            </Match>
            <Match when={files() === null}>
              <text fg={PALETTE.textMuted}>Reading the diff and comments...</text>
            </Match>
            <Match when={files()?.length === 0 && threads().length === 0}>
              <text fg={PALETTE.textMuted}>It changes nothing, and no one has commented.</text>
            </Match>
            <Match when={true}>
              <For each={drawn()}>{({ row, selected }) => drawRow(row, selected)}</For>
            </Match>
          </Switch>
        </box>
        <text fg={PALETTE.textMuted}>{truncateToWidth(keys(), inner())}</text>
      </Dialog>
      <Show when={writing()}>
        {(shown: Accessor<Writing>) => (
          <CommentEditor
            on={shown().on}
            draft={drafts.get(shown().key) ?? ""}
            icons={props.icons}
            post={(text) => post(shown(), text)}
            onDraft={(text) => drafts.set(shown().key, text)}
            onClose={() => setWriting(null)}
          />
        )}
      </Show>
      <AskingDialog icons={props.icons} />
    </>
  );
}
