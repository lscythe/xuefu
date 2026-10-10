import { useKeyboard } from "@opentui/solid";
import {
  type Accessor,
  type Component,
  createEffect,
  createMemo,
  createSignal,
  For,
  Match,
  on,
  onCleanup,
  Show,
  Switch,
} from "solid-js";
import {
  type ConfirmationToken,
  confirmationTokenFor,
} from "../../../application/commands/command";
import type { CommandBus } from "../../../application/commands/command-bus";
import type { AppError } from "../../../application/errors";
import type { ConfirmationPrompt } from "../../../domain/shared/confirmation";
import { validationError } from "../../../domain/shared/errors";
import type { AbsolutePath } from "../../../domain/shared/path";
import { err, ok, type Result } from "../../../domain/shared/result";
import type { Workspace } from "../../../domain/workspace/workspace";
import { ConfirmDialog } from "../../../tui/confirm-dialog";
import { ErrorLine } from "../../../tui/error-line";
import { cycle, scrollOffset } from "../../../tui/list-navigation";
import { fitHints, type PanelHint } from "../../../tui/shell/panel-status";
import type { SectionProps } from "../../../tui/shell/section-props";
import { truncateToWidth } from "../../../tui/shell/tab-labels";
import { PALETTE } from "../../../tui/theme/palette";
import { statusGlyph } from "../../../tui/theme/status";
import type { Committed, GitActions } from "../application/actions";
import type { GitClient, GitFiles } from "../application/git-client";
import { localName } from "../domain/branches";
import {
  changeLetter,
  describeBranch,
  type GitStatus,
  isClean,
  stagedFiles,
  unstagedFiles,
} from "../domain/status";
import { BranchPicker } from "./branch-picker";
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

/** Everything the section needs from the git plugin. */
export interface GitSection {
  /** For reading: status, branches and remotes. */
  readonly client: GitClient;
  /** For changing: the plugin's commands, run through the bus they are registered on. */
  readonly actions: GitActions;
  readonly invoke: CommandBus["invoke"];
  readonly refreshMs: number;
}

type Read = Result<GitStatus | null, AppError>;

/** A commit being written: where it goes, fixed when the editor opened. */
interface Writing {
  readonly workspace: string;
  readonly folder: AbsolutePath;
  readonly branch: string | null;
  readonly staged: number;
}

/** A line above the status: what is running, or how it went. */
interface Banner {
  readonly kind: "running" | "success";
  readonly text: string;
}

/** A confirmation on screen, and how to answer it. */
interface Asking {
  readonly prompt: ConfirmationPrompt;
  readonly answer: (approved: boolean) => void;
}

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/** A failure the section finds before asking git: there is nothing for the key to act on. */
const cannot = (message: string, reason: string) =>
  validationError(message, [{ path: "git", message: reason }]);

/**
 * The Git section: the front workspace's status, read when it opens, every `refreshMs` while it
 * stays open, and straight after each change. Reads never overlap, and one still running when the
 * section closes is stopped. With the keyboard, a cursor picks files to stage or unstage, `c`
 * writes a commit, `b` finds a branch, and `f`, `p` and `P` fetch, pull and push. What the bus
 * says needs confirming is asked in a dialog first.
 */
export function gitView(section: GitSection): Component<SectionProps> {
  const { client, actions, invoke, refreshMs } = section;
  // Messages left unfinished, by workspace, kept while XueFu runs.
  const drafts = new Map<string, string>();

  return (props) => {
    const [read, setRead] = createSignal<{ readonly id: string; readonly result: Read } | null>(
      null,
    );
    const [cursor, setCursor] = createSignal(0);
    const [busy, setBusy] = createSignal(false);
    const [writing, setWriting] = createSignal<Writing | null>(null);
    const [picking, setPicking] = createSignal(false);
    const [asking, setAsking] = createSignal<Asking | null>(null);
    const [banner, setBanner] = createSignal<Banner | null>(null);
    const ascii = () => props.icons === "ascii";
    // Reads status again at once; set once there is a workspace to read.
    let reload: () => void = () => undefined;

    createEffect(() => {
      const workspace = props.workspace;
      setCursor(0);
      setBanner(null);
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

    // A dialog of the section's has every key while it is open.
    const modal = () => writing() !== null || picking() || asking() !== null;
    createEffect(on(modal, (open) => props.setModal(open), { defer: true }));
    onCleanup(() => {
      if (modal()) props.setModal(false);
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
      const line = banner();
      const top: StatusRow[] =
        line === null
          ? []
          : [
              {
                kind: "text",
                text: `${statusGlyph(line.kind, props.icons)} ${line.text}`,
                tone: line.kind === "running" ? "busy" : "success",
              },
            ];
      return [...top, ...statusRows(shown, ascii())];
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
      const onBranch = shown.branch !== null;
      const hints: (PanelHint | null)[] = [
        file === null
          ? null
          : { text: file.side === "staged" ? "space unstage" : "space stage", rank: 0 },
        all === null ? null : { text: all.stage ? "a stage all" : "a unstage all", rank: 5 },
        canCommit() ? { text: "c commit", rank: 1 } : null,
        { text: "b branch", rank: 4 },
        { text: "f fetch", rank: 6 },
        onBranch && shown.upstream !== null ? { text: "p pull", rank: 3 } : null,
        onBranch ? { text: "P push", rank: 2 } : null,
      ];
      props.setKeys(
        fitHints(
          hints.filter((hint) => hint !== null),
          // The frame's corners and the spaces around the keys.
          props.width - 2,
          ascii(),
        ),
      );
    });

    /** Shows a confirmation and resolves to the answer. */
    const ask = (prompt: ConfirmationPrompt) =>
      new Promise<boolean>((resolve) =>
        setAsking({
          prompt,
          answer: (approved) => {
            setAsking(null);
            resolve(approved);
          },
        }),
      );

    /**
     * Runs a command, asking first when the bus says it must, then running it again with that
     * approval; `started` is called once it is really underway. Null when it was not approved.
     */
    const approved = async <T,>(
      run: (confirmation?: ConfirmationToken) => Promise<Result<T, AppError>>,
      started: () => void = () => undefined,
    ): Promise<Result<T | null, AppError>> => {
      const first = await run();
      if (first.ok || first.error.kind !== "confirmation-required") return first;
      const required = first.error;
      if (!(await ask(required.prompt))) return ok(null);
      started();
      return run(confirmationTokenFor(required));
    };

    /** Runs a change to the repository one at a time, then reads its status again. */
    const change = async <T,>(
      run: (folder: AbsolutePath) => Promise<Result<T, AppError>>,
    ): Promise<T | null> => {
      const workspace = props.workspace;
      if (workspace === null || busy()) return null;
      setBusy(true);
      const done = await run(workspace.path);
      setBusy(false);
      reload();
      if (done.ok) return done.value;
      setBanner(null);
      props.report(done.error);
      return null;
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
    };

    const closeEditor = (made: Committed | null) => {
      const was = writing();
      setWriting(null);
      if (made === null || was === null) return;
      drafts.delete(was.workspace);
      setBanner({ kind: "success", text: `Committed ${made.commit.slice(0, 7)} ${made.subject}` });
      reload();
    };

    const fetch = () => {
      setBanner({ kind: "running", text: "Fetching..." });
      void change(async (folder) => {
        const fetched = await invoke(actions.fetch, { folder });
        if (fetched.ok) setBanner({ kind: "success", text: "Fetched from the remote." });
        return fetched;
      });
    };

    const pull = (shown: GitStatus) => {
      const branch = shown.branch;
      const upstream = shown.upstream;
      if (branch === null || upstream === null) {
        props.report(
          branch === null
            ? cannot("HEAD is detached", "switch to a branch to pull into it")
            : cannot(`${branch} tracks no remote branch`, "push it first to publish it"),
        );
        return;
      }
      void change(async (folder) => {
        const pulled = await approved(
          (confirmation) =>
            invoke(
              actions.pull,
              { folder, branch, upstream, behind: shown.behind },
              confirmation === undefined ? {} : { confirmation },
            ),
          () => setBanner({ kind: "running", text: `Pulling from ${upstream}...` }),
        );
        if (pulled.ok && pulled.value !== null) {
          setBanner({ kind: "success", text: `Pulled from ${upstream}.` });
        }
        return pulled;
      });
    };

    /** The remote to publish a branch on: origin, or the only one there is. */
    const publishTo = async (folder: AbsolutePath): Promise<Result<string, AppError>> => {
      const listed = await client.remotes(folder);
      if (!listed.ok) return listed;
      const remotes = listed.value;
      const remote = remotes.includes("origin")
        ? "origin"
        : remotes.length === 1
          ? remotes[0]
          : null;
      return remote === null || remote === undefined
        ? err(
            cannot(
              remotes.length === 0 ? "No remote to push to" : "More than one remote to push to",
              remotes.length === 0
                ? "add one with git remote add origin <url>"
                : "push this branch once in a terminal to choose one",
            ),
          )
        : ok(remote);
    };

    const push = (shown: GitStatus) => {
      const branch = shown.branch;
      if (branch === null) {
        props.report(cannot("HEAD is detached", "switch to a branch to push it"));
        return;
      }
      const upstream = shown.upstream;
      void change(async (folder) => {
        const remote =
          upstream === null ? await publishTo(folder) : ok(upstream.split("/", 1)[0] ?? "");
        if (!remote.ok) return remote;
        const to = upstream ?? `${remote.value}/${branch}`;
        const pushed = await approved(
          (confirmation) =>
            invoke(
              actions.push,
              { folder, branch, remote: remote.value, upstream, ahead: shown.ahead },
              confirmation === undefined ? {} : { confirmation },
            ),
          () => setBanner({ kind: "running", text: `Pushing to ${to}...` }),
        );
        if (pushed.ok && pushed.value !== null) {
          setBanner({
            kind: "success",
            text:
              upstream === null
                ? `Published ${branch} on ${remote.value}.`
                : `Pushed ${plural(shown.ahead, "commit", "commits")} to ${to}.`,
          });
        }
        return pushed;
      });
    };

    /** Runs a branch change from the picker; on success the picker closes and says what happened. */
    const fromPicker = async (
      run: (folder: AbsolutePath) => Promise<Result<unknown, AppError>>,
      done: string,
    ) => {
      const workspace = props.workspace;
      if (workspace === null) return ok(null);
      const ran = await run(workspace.path);
      if (ran.ok) {
        setPicking(false);
        setCursor(0);
        setBanner({ kind: "success", text: done });
        reload();
      }
      return ran;
    };

    useKeyboard((key) => {
      const shown = status();
      if (!props.focused || modal() || busy() || shown === undefined || shown === null) return;
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
          setBanner(null);
          void change((folder) =>
            invoke(file.side === "staged" ? actions.unstage : actions.stage, {
              folder,
              files: file.files,
            }),
          );
          return;
        }
        case "a": {
          const all = stageAll(shown);
          if (all === null) return;
          setBanner(null);
          void change((folder) =>
            invoke(all.stage ? actions.stage : actions.unstage, { folder, files: all.files }),
          );
          return;
        }
        case "c":
          if (!canCommit()) return;
          // The editor takes focus at once; without this the "c" would be typed into it.
          key.preventDefault();
          openEditor(shown);
          return;
        case "b":
          key.preventDefault();
          setPicking(true);
          return;
        case "f":
          fetch();
          return;
        case "p":
          if (key.shift) push(shown);
          else pull(shown);
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
              commit={(message, signal) =>
                invoke(actions.commit, { folder: commit().folder, message }, { signal })
              }
              onDraft={(text) => drafts.set(commit().workspace, text)}
              onClose={closeEditor}
            />
          )}
        </Show>
        <Show when={picking() ? props.workspace : null}>
          {(workspace: Accessor<Workspace>) => (
            <BranchPicker
              load={() => client.branches(workspace().path)}
              icons={props.icons}
              onSwitch={(branch) =>
                fromPicker(
                  (folder) =>
                    invoke(actions.checkout, {
                      folder,
                      name: branch.name,
                      track: branch.remote !== null,
                    }),
                  `Switched to ${localName(branch)}.`,
                )
              }
              onCreate={(name) =>
                fromPicker(
                  (folder) => invoke(actions.createBranch, { folder, name, start: null }),
                  `Created ${name} and switched to it.`,
                )
              }
              onDelete={(branch, force) =>
                approved((confirmation) =>
                  invoke(
                    actions.deleteBranch,
                    { folder: workspace().path, name: branch.name, force },
                    confirmation === undefined ? {} : { confirmation },
                  ),
                )
              }
              onClose={() => setPicking(false)}
            />
          )}
        </Show>
        <Show when={asking()}>
          {(shown: Accessor<Asking>) => (
            <ConfirmDialog prompt={shown().prompt} icons={props.icons} onAnswer={shown().answer} />
          )}
        </Show>
      </>
    );
  };
}
