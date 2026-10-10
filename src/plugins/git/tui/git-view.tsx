import {
  type Accessor,
  type Component,
  createEffect,
  createSignal,
  For,
  Match,
  onCleanup,
  Switch,
} from "solid-js";
import type { AppError } from "../../../application/errors";
import type { Result } from "../../../domain/shared/result";
import { ErrorLine } from "../../../tui/error-line";
import type { SectionProps } from "../../../tui/shell/section-props";
import { truncateToWidth } from "../../../tui/shell/tab-labels";
import { PALETTE } from "../../../tui/theme/palette";
import type { GitClient } from "../application/git-client";
import {
  changeLetter,
  describeBranch,
  type GitStatus,
  isClean,
  stagedFiles,
  unstagedFiles,
} from "../domain/status";

type Tone = keyof typeof PALETTE;

/** One row of the section: a heading, or a file with its change letter. */
export type StatusRow =
  | { readonly kind: "text"; readonly text: string; readonly tone: Tone }
  | { readonly kind: "heading"; readonly text: string; readonly tone: Tone }
  | {
      readonly kind: "file";
      readonly letter: string;
      readonly path: string;
      readonly tone: Tone;
    };

const arrow = (ascii: boolean) => (ascii ? " <- " : " ← ");

/** The section's rows: where the branch stands, then each group of files under a heading. */
export function statusRows(status: GitStatus, ascii: boolean): StatusRow[] {
  const group = (
    title: string,
    tone: Tone,
    files: readonly { letter: string; path: string }[],
  ): StatusRow[] =>
    files.length === 0
      ? []
      : [
          { kind: "text", text: "", tone: "text" },
          { kind: "heading", text: `${title} (${files.length})`, tone },
          ...files.map((file): StatusRow => ({ kind: "file", ...file, tone })),
        ];
  const named = (path: string, from: string | null) =>
    from === null ? path : `${path}${arrow(ascii)}${from}`;
  return [
    { kind: "text", text: describeBranch(status), tone: "textMuted" },
    ...group(
      "Conflicts",
      "error",
      status.conflicts.map((path) => ({ letter: "U", path })),
    ),
    ...group(
      "Staged",
      "success",
      stagedFiles(status).map((file) => ({
        letter: changeLetter(file.staged),
        path: named(file.path, file.from),
      })),
    ),
    ...group(
      "Not staged",
      "warning",
      unstagedFiles(status).map((file) => ({
        letter: changeLetter(file.unstaged),
        path: file.path,
      })),
    ),
    ...group(
      "Untracked",
      "textMuted",
      status.untracked.map((path) => ({ letter: "?", path })),
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

/** Rows that fit in `rows`, the last one saying how many more there are when some do not. */
export function fitRows(all: readonly StatusRow[], rows: number): StatusRow[] {
  if (all.length <= rows) return [...all];
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

type Read = Result<GitStatus | null, AppError>;

/**
 * The Git section: the front workspace's status, read when it opens and every `refreshMs` while it
 * stays open. Reads never overlap, and one still running when the section closes is stopped.
 */
export function gitView(client: GitClient, refreshMs: number): Component<SectionProps> {
  return (props) => {
    const [read, setRead] = createSignal<{ readonly id: string; readonly result: Read } | null>(
      null,
    );
    const ascii = () => props.icons === "ascii";

    createEffect(() => {
      const workspace = props.workspace;
      if (workspace === null) return;
      let running: AbortController | null = null;
      let stopped = false;
      const load = async () => {
        if (running !== null) return;
        running = new AbortController();
        const result = await client.status(workspace.path, running.signal);
        running = null;
        if (!stopped) setRead({ id: workspace.id, result });
      };
      void load();
      const timer = setInterval(() => void load(), refreshMs);
      onCleanup(() => {
        stopped = true;
        clearInterval(timer);
        running?.abort();
      });
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

    createEffect(() => {
      const shown = status();
      props.setStatus(shown === undefined || shown === null ? null : branchBadge(shown, ascii()));
    });

    return (
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
          {(status: Accessor<GitStatus>) => (
            <For each={fitRows(statusRows(status(), ascii()), props.rows)}>
              {(row) => (
                <text flexShrink={0}>
                  {row.kind === "file" ? (
                    <>
                      <span style={{ fg: PALETTE[row.tone] }}>{`${row.letter}  `}</span>
                      <span style={{ fg: PALETTE.text }}>
                        {truncateToWidth(row.path, Math.max(1, props.width - 3))}
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
          )}
        </Match>
      </Switch>
    );
  };
}
