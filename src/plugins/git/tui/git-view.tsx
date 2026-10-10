import { useKeyboard } from "@opentui/solid";
import {
  type Accessor,
  type Component,
  createEffect,
  createMemo,
  createSignal,
  For,
  Match,
  onCleanup,
  Show,
  Switch,
} from "solid-js";
import type { AppError } from "../../../application/errors";
import type { AbsolutePath } from "../../../domain/shared/path";
import type { Result } from "../../../domain/shared/result";
import { ErrorLine } from "../../../tui/error-line";
import { cycle, scrollOffset } from "../../../tui/list-navigation";
import { panelKeys } from "../../../tui/shell/panel-status";
import type { SectionProps } from "../../../tui/shell/section-props";
import { truncateToWidth } from "../../../tui/shell/tab-labels";
import { PALETTE } from "../../../tui/theme/palette";
import { statusGlyph } from "../../../tui/theme/status";
import type { Committed } from "../application/actions";
import type { GitClient, GitFiles } from "../application/git-client";
import {
  changeLetter,
  describeBranch,
  type GitStatus,
  isClean,
  stagedFiles,
  unstagedFiles,
} from "../domain/status";
import { CommitEditor } from "./commit-editor";

type Tone = keyof typeof PALETTE;

/** Which list a file is in, which decides whether space stages or unstages it. */
type FileSide = "conflict" | "staged" | "unstaged" | "untracked";

/** One row of the section: a line of text, a heading, or a file with its change letter. */
export type StatusRow =
  | { readonly kind: "text"; readonly text: string; readonly tone: Tone }
  | { readonly kind: "heading"; readonly text: string; readonly tone: Tone }
  | {
      readonly kind: "file";
      readonly letter: string;
      /** As shown: a rename also names where it came from. */
      readonly path: string;
      readonly tone: Tone;
      readonly side: FileSide;
      /** The paths to stage or unstage it: a staged rename takes both its sides. */
      readonly files: readonly string[];
    };

type FileRow = Extract<StatusRow, { kind: "file" }>;

const arrow = (ascii: boolean) => (ascii ? " <- " : " ← ");

/** The section's rows: where the branch stands, then each group of files under a heading. */
export function statusRows(status: GitStatus, ascii: boolean): StatusRow[] {
  const group = (
    title: string,
    tone: Tone,
    side: FileSide,
    files: readonly Omit<FileRow, "kind" | "tone" | "side">[],
  ): StatusRow[] =>
    files.length === 0
      ? []
      : [
          { kind: "text", text: "", tone: "text" },
          { kind: "heading", text: `${title} (${files.length})`, tone },
          ...files.map((file): StatusRow => ({ kind: "file", ...file, tone, side })),
        ];
  return [
    { kind: "text", text: describeBranch(status), tone: "textMuted" },
    ...group(
      "Conflicts",
      "error",
      "conflict",
      status.conflicts.map((path) => ({ letter: "U", path, files: [path] })),
    ),
    ...group(
      "Staged",
      "success",
      "staged",
      stagedFiles(status).map((file) => ({
        letter: changeLetter(file.staged),
        path: file.from === null ? file.path : `${file.path}${arrow(ascii)}${file.from}`,
        files: file.from === null ? [file.path] : [file.path, file.from],
      })),
    ),
    ...group(
      "Not staged",
      "warning",
      "unstaged",
      unstagedFiles(status).map((file) => ({
        letter: changeLetter(file.unstaged),
        path: file.path,
        files: [file.path],
      })),
    ),
    ...group(
      "Untracked",
      "textMuted",
      "untracked",
      status.untracked.map((path) => ({ letter: "?", path, files: [path] })),
    ),
    ...(isClean(status)
      ? [
          { kind: "text", text: "", tone: "text" } as const,
          {
            kind: "text",
            text: "Nothing to commit, working tree clean.",
            tone: "success",
          } as const,
        ]
      : []),
  ];
}

/**
 * Rows that fit in `rows`. With a row selected, the window follows it; otherwise the list is cut
 * short with a last row saying how many more there are.
 */
export function fitRows(
  all: readonly StatusRow[],
  rows: number,
  selected: number | null = null,
): StatusRow[] {
  if (all.length <= rows) return [...all];
  if (selected !== null) {
    const top = scrollOffset(selected, all.length, rows);
    return all.slice(top, top + rows);
  }
  const shown = all.slice(0, Math.max(0, rows - 1));
  return [
    ...shown,
    { kind: "text", text: `… and ${all.length - shown.length} more`, tone: "textMuted" },
  ];
}

/** The branch and how it compares with upstream, for the panel's frame. */
export function branchBadge(status: GitStatus, ascii: boolean): string {
  const name = status.branch ?? `detached ${status.commit?.slice(0, 7) ?? ""}`.trimEnd();
  const drift = [
    status.ahead > 0 ? `${ascii ? "+" : "↑"}${status.ahead}` : null,
    status.behind > 0 ? `${ascii ? "-" : "↓"}${status.behind}` : null,
  ].filter((part) => part !== null);
  return [name, ...drift].join(" ");
}

/**
 * What `a` does: stages every change, or unstages everything once all of it is staged. Conflicts
 * are left out, so that marking one resolved is always a choice made file by file.
 */
export function stageAll(
  status: GitStatus,
): { readonly stage: boolean; readonly files: GitFiles } | null {
  const waiting = [...unstagedFiles(status).map((file) => file.path), ...status.untracked];
  if (waiting.length > 0) {
    return { stage: true, files: status.conflicts.length === 0 ? "all" : waiting };
  }
  return stagedFiles(status).length > 0 ? { stage: false, files: "all" } : null;
}

/** What the section changes in a repository; each goes through the command bus. */
export interface GitSectionActions {
  readonly stage: (folder: AbsolutePath, files: GitFiles) => Promise<Result<unknown, AppError>>;
  readonly unstage: (folder: AbsolutePath, files: GitFiles) => Promise<Result<unknown, AppError>>;
  readonly commit: (
    folder: AbsolutePath,
    message: string,
    signal: AbortSignal,
  ) => Promise<Result<Committed, AppError>>;
}

type Read = Result<GitStatus | null, AppError>;

/** A commit being written: where it goes, fixed when the editor opened. */
interface Writing {
  readonly workspace: string;
  readonly folder: AbsolutePath;
  readonly branch: string | null;
  readonly staged: number;
}

/**
 * The Git section: the front workspace's status, read when it opens, every `refreshMs` while it
 * stays open, and straight after each change. Reads never overlap, and one still running when the
 * section closes is stopped. With the keyboard, a cursor picks files to stage or unstage, and `c`
 * writes a commit.
 */
export function gitView(
  client: GitClient,
  actions: GitSectionActions,
  refreshMs: number,
): Component<SectionProps> {
  // Messages left unfinished, by workspace, kept while XueFu runs.
  const drafts = new Map<string, string>();

  return (props) => {
    const [read, setRead] = createSignal<{ readonly id: string; readonly result: Read } | null>(
      null,
    );
    const [cursor, setCursor] = createSignal(0);
    const [busy, setBusy] = createSignal(false);
    const [writing, setWriting] = createSignal<Writing | null>(null);
    const [committed, setCommitted] = createSignal<Committed | null>(null);
    const ascii = () => props.icons === "ascii";
    // Reads status again at once; set once there is a workspace to read.
    let reload: () => void = () => undefined;

    createEffect(() => {
      const workspace = props.workspace;
      setCursor(0);
      setCommitted(null);
      if (workspace === null) return;
      let running: AbortController | null = null;
      let again = false;
      let stopped = false;
      const load = async () => {
        if (running !== null) {
          // A change landed mid-read; read once more when this one is done.
          again = true;
          return;
        }
        running = new AbortController();
        const result = await client.status(workspace.path, running.signal);
        running = null;
        if (stopped) return;
        setRead({ id: workspace.id, result });
        if (again) {
          again = false;
          void load();
        }
      };
      reload = () => void load();
      void load();
      const timer = setInterval(() => void load(), refreshMs);
      onCleanup(() => {
        stopped = true;
        clearInterval(timer);
        running?.abort();
      });
    });

    onCleanup(() => {
      if (writing() !== null) props.setModal(false);
    });

    /** The latest read of the workspace in front; null until there is one. */
    const current = (): Read | null => {
      const latest = read();
      return latest !== null && latest.id === props.workspace?.id ? latest.result : null;
    };

    const failure = () => {
      const result = current();
      return result !== null && !result.ok ? result.error : null;
    };
    /** The status read; null outside a repository, undefined before a read or after a failure. */
    const status = () => {
      const result = current();
      return result?.ok ? result.value : undefined;
    };

    // Memos, so the cursor's file is the same row object wherever it is looked up.
    const rows = createMemo((): StatusRow[] => {
      const shown = status();
      if (shown === undefined || shown === null) return [];
      const done = committed();
      const banner: StatusRow[] =
        done === null
          ? []
          : [
              {
                kind: "text",
                text: `${statusGlyph("success", props.icons)} Committed ${done.commit.slice(0, 7)} ${done.subject}`,
                tone: "success",
              },
            ];
      return [...banner, ...statusRows(shown, ascii())];
    });
    const files = createMemo(() => rows().filter((row): row is FileRow => row.kind === "file"));
    /** The file under the cursor, kept in range as the lists change. */
    const selected = () => {
      const all = files();
      return all.length === 0 ? null : (all[Math.min(cursor(), all.length - 1)] ?? null);
    };
    const canCommit = () => {
      const shown = status();
      return shown != null && stagedFiles(shown).length > 0 && shown.conflicts.length === 0;
    };

    createEffect(() => {
      const shown = status();
      props.setStatus(shown === undefined || shown === null ? null : branchBadge(shown, ascii()));
    });

    createEffect(() => {
      const shown = status();
      if (!props.focused || shown === undefined || shown === null) {
        props.setKeys(null);
        return;
      }
      const file = selected();
      const all = stageAll(shown);
      props.setKeys(
        panelKeys(
          [
            file === null ? null : file.side === "staged" ? "space unstage" : "space stage",
            all === null ? null : all.stage ? "a stage all" : "a unstage all",
            canCommit() ? "c commit" : null,
          ],
          ascii(),
        ),
      );
    });

    /** Runs a change to the repository, then reads its status again. */
    const change = async (run: (folder: AbsolutePath) => Promise<Result<unknown, AppError>>) => {
      const workspace = props.workspace;
      if (workspace === null || busy()) return;
      setBusy(true);
      setCommitted(null);
      const done = await run(workspace.path);
      setBusy(false);
      if (!done.ok) props.report(done.error);
      reload();
    };

    const openEditor = (shown: GitStatus) => {
      const workspace = props.workspace;
      if (workspace === null) return;
      setWriting({
        workspace: workspace.id,
        folder: workspace.path,
        branch: shown.branch,
        staged: stagedFiles(shown).length,
      });
      props.setModal(true);
    };

    const closeEditor = (made: Committed | null) => {
      const was = writing();
      setWriting(null);
      props.setModal(false);
      if (made === null || was === null) return;
      drafts.delete(was.workspace);
      setCommitted(made);
      reload();
    };

    useKeyboard((key) => {
      const shown = status();
      if (!props.focused || writing() !== null || busy() || shown === undefined || shown === null) {
        return;
      }
      const count = files().length;
      switch (key.name) {
        case "up":
        case "k":
          if (count > 0) setCursor(cycle(Math.min(cursor(), count - 1), -1, count));
          return;
        case "down":
        case "j":
          if (count > 0) setCursor(cycle(Math.min(cursor(), count - 1), 1, count));
          return;
        case "home":
          setCursor(0);
          return;
        case "end":
          setCursor(Math.max(0, count - 1));
          return;
        case "space": {
          const file = selected();
          if (file === null) return;
          void change((folder) =>
            file.side === "staged"
              ? actions.unstage(folder, file.files)
              : actions.stage(folder, file.files),
          );
          return;
        }
        case "a": {
          const all = stageAll(shown);
          if (all === null) return;
          void change((folder) =>
            all.stage ? actions.stage(folder, all.files) : actions.unstage(folder, all.files),
          );
          return;
        }
        case "c":
          if (!canCommit()) return;
          // The editor takes focus at once; without this the "c" would be typed into it.
          key.preventDefault();
          openEditor(shown);
          return;
        default:
          return;
      }
    });

    /** Which of the drawn rows is the cursor's, when the section has the keyboard. */
    const cursorRow = () => {
      const file = selected();
      return props.focused && file !== null ? rows().indexOf(file) : null;
    };

    const drawn = () => {
      const all = rows();
      const at = cursorRow();
      return fitRows(all, props.rows, at).map((row) => ({ row, chosen: row === all[at ?? -1] }));
    };

    const padded = (text: string, width: number) =>
      text + " ".repeat(Math.max(0, width - Bun.stringWidth(text)));

    return (
      <>
        <Switch>
          <Match when={props.workspace === null}>
            <text fg={PALETTE.textMuted}>Open a workspace with Ctrl+W to see its git status.</text>
          </Match>
          <Match when={current() === null}>
            <text fg={PALETTE.textMuted}>Reading git status...</text>
          </Match>
          <Match when={failure()}>
            {(error: Accessor<AppError>) => <ErrorLine error={error()} ascii={ascii()} />}
          </Match>
          <Match when={status() === null}>
            <text
              fg={PALETTE.textMuted}
            >{`${props.workspace?.name ?? ""} is not a git repository.`}</text>
          </Match>
          <Match when={status()}>
            <For each={drawn()}>
              {({ row, chosen }) => (
                <text flexShrink={0}>
                  {row.kind === "file" ? (
                    <>
                      <span
                        style={{
                          fg: PALETTE[row.tone],
                          bg: chosen ? PALETTE.selectionBg : PALETTE.bg,
                        }}
                      >{`${row.letter}  `}</span>
                      <span
                        style={{
                          fg: chosen ? PALETTE.selectionFg : PALETTE.text,
                          bg: chosen ? PALETTE.selectionBg : PALETTE.bg,
                        }}
                      >
                        {padded(
                          truncateToWidth(row.path, Math.max(1, props.width - 3)),
                          chosen ? props.width - 3 : 0,
                        )}
                      </span>
                    </>
                  ) : row.kind === "heading" ? (
                    <span style={{ fg: PALETTE[row.tone] }}>
                      <b>{row.text}</b>
                    </span>
                  ) : (
                    <span style={{ fg: PALETTE[row.tone] }}>
                      {truncateToWidth(row.text, props.width)}
                    </span>
                  )}
                </text>
              )}
            </For>
          </Match>
        </Switch>
        <Show when={writing()}>
          {(commit: Accessor<Writing>) => (
            <CommitEditor
              branch={commit().branch}
              staged={commit().staged}
              draft={drafts.get(commit().workspace) ?? ""}
              icons={props.icons}
              commit={(message, signal) => actions.commit(commit().folder, message, signal)}
              onDraft={(text) => drafts.set(commit().workspace, text)}
              onClose={closeEditor}
            />
          )}
        </Show>
      </>
    );
  };
}
