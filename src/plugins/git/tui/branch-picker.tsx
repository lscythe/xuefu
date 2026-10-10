import { useKeyboard, usePaste, useTerminalDimensions } from "@opentui/solid";
import { type Accessor, createMemo, createSignal, For, Match, Show, Switch } from "solid-js";
import type { AppError } from "../../../application/errors";
import { rankFuzzy } from "../../../application/search/fuzzy";
import { assertNever } from "../../../domain/shared/assert-never";
import type { Result } from "../../../domain/shared/result";
import { Dialog, dialogListRows, dialogWidth } from "../../../tui/dialog";
import { ErrorLine } from "../../../tui/error-line";
import { Highlighted } from "../../../tui/highlighted";
import { cycle, scrollOffset } from "../../../tui/list-navigation";
import { eraseChar, eraseWord, pastedText } from "../../../tui/query-input/edit";
import { queryActionFor } from "../../../tui/query-input/keys";
import { truncateToWidth } from "../../../tui/shell/tab-labels";
import { PALETTE } from "../../../tui/theme/palette";
import type { IconSet } from "../../../tui/theme/status";
import { type Branch, branchChoices, branchName } from "../domain/branches";

export type BranchRow =
  | { readonly kind: "heading"; readonly label: string }
  | { readonly kind: "branch"; readonly branch: Branch; readonly hits: readonly number[] }
  /** Makes a branch of that name at HEAD and switches to it. */
  | { readonly kind: "create"; readonly name: string };

type Choice = Exclude<BranchRow, { kind: "heading" }>;
const isChoice = (row: BranchRow): row is Choice => row.kind !== "heading";

/** A branch to offer for the work in progress, named for its issue. */
export interface SuggestedBranch {
  readonly issue: string;
  /** Null when no name git takes could be made. */
  readonly name: string | null;
}

/**
 * Rows for a query: local branches, then remote ones, under headings when the query is blank;
 * otherwise those matching, best first, with a row to create the branch when the query is a
 * name git accepts and no local branch has it. With work in progress and no local branch named
 * for its issue, a blank query first offers to create `suggested`.
 */
export function branchRows(
  branches: readonly Branch[],
  query: string,
  suggested: SuggestedBranch | null = null,
): BranchRow[] {
  const choices = branchChoices(branches);
  const trimmed = query.trim();
  if (trimmed === "") {
    const offer =
      suggested?.name != null &&
      !choices.some(
        (branch) =>
          branch.remote === null &&
          branch.name.toUpperCase().includes(suggested.issue.toUpperCase()),
      )
        ? [
            { kind: "heading", label: `For ${suggested.issue}` } as const,
            { kind: "create", name: suggested.name } as const,
          ]
        : [];
    const local = choices.filter((branch) => branch.remote === null);
    const remote = choices.filter((branch) => branch.remote !== null);
    const group = (label: string, list: readonly Branch[]): BranchRow[] =>
      list.length === 0
        ? []
        : [
            { kind: "heading", label },
            ...list.map((branch): BranchRow => ({ kind: "branch", branch, hits: [] })),
          ];
    return [...offer, ...group("Local", local), ...group("Remote", remote)];
  }
  const matches = rankFuzzy(choices, trimmed, (branch) => [branch.name]).map(
    ({ item, match }): BranchRow => ({ kind: "branch", branch: item, hits: match.positions }),
  );
  const taken = choices.some((branch) => branch.remote === null && branch.name === trimmed);
  const creatable = !taken && branchName(trimmed).ok;
  return [...matches, ...(creatable ? [{ kind: "create", name: trimmed } as const] : [])];
}

export interface BranchPickerProps {
  /** Read fresh on every open. */
  readonly load: () => Promise<Result<Branch[], AppError>>;
  /** Offered first for the work in progress; null when there is none. */
  readonly suggested?: SuggestedBranch | null;
  readonly icons: IconSet;
  /** Switches to the branch; on failure the picker stays open and shows why. */
  readonly onSwitch: (branch: Branch) => Promise<Result<unknown, AppError>>;
  readonly onCreate: (name: string) => Promise<Result<unknown, AppError>>;
  /**
   * Deletes the branch once approved: resolves to whether it went, or null when it was not
   * approved. Git keeps an unmerged branch unless forced.
   */
  readonly onDelete: (
    branch: Branch,
    force: boolean,
  ) => Promise<Result<{ readonly deleted: boolean } | null, AppError>>;
  readonly onClose: () => void;
}

/** A note under the list: what was just done, or what to do next. */
interface Note {
  readonly text: string;
  readonly tone: "success" | "warning";
}

/**
 * Finds a branch by typing part of its name. Enter switches to it, or creates the branch typed;
 * Ctrl+D deletes the one picked, and again forces it once git says its commits are not merged.
 */
export function BranchPicker(props: BranchPickerProps) {
  const dimensions = useTerminalDimensions();
  const [loaded, setLoaded] = createSignal<Result<Branch[], AppError> | null>(null);
  const [query, setQuery] = createSignal("");
  const [selected, setSelected] = createSignal(0);
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<AppError | null>(null);
  const [note, setNote] = createSignal<Note | null>(null);
  // The branch git kept as unmerged; Ctrl+D on it again forces the delete.
  const [unmerged, setUnmerged] = createSignal<string | null>(null);

  const branches = () => {
    const result = loaded();
    return result?.ok === true ? result.value : [];
  };
  const failure = () => {
    const result = loaded();
    return result?.ok === false ? result.error : null;
  };
  const rows = createMemo(() => branchRows(branches(), query(), props.suggested ?? null));
  const choices = createMemo(() => rows().filter(isChoice));
  const chosen = () => choices()[Math.min(selected(), choices().length - 1)];

  const load = async () => {
    setLoaded(await props.load());
    setSelected((index) => Math.min(index, Math.max(0, choices().length - 1)));
  };
  void load();

  const editQuery = (next: string) => {
    setQuery(next);
    setSelected(0);
    setError(null);
    setNote(null);
  };

  /** Runs one thing at a time, keeping the picker open with the error when it fails. */
  const act = async <T,>(run: () => Promise<Result<T, AppError>>): Promise<T | null> => {
    if (busy()) return null;
    setBusy(true);
    setError(null);
    setNote(null);
    const done = await run();
    setBusy(false);
    if (!done.ok) {
      setError(done.error);
      return null;
    }
    return done.value;
  };

  const remove = async (branch: Branch) => {
    if (branch.remote !== null || branch.current) {
      setNote({
        text: branch.current
          ? "That is the branch you are on; switch to another first."
          : "Only branches here can be deleted.",
        tone: "warning",
      });
      return;
    }
    const force = unmerged() === branch.name;
    const outcome = await act(() => props.onDelete(branch, force));
    if (outcome === null) return;
    if (outcome.deleted) {
      setUnmerged(null);
      setNote({ text: `Deleted ${branch.name}.`, tone: "success" });
      await load();
    } else {
      setUnmerged(branch.name);
      setNote({
        text: `${branch.name} is not merged; ctrl+d again deletes it anyway.`,
        tone: "warning",
      });
    }
  };

  useKeyboard((key) => {
    if (busy()) return;
    if (key.ctrl && key.name === "d") {
      const choice = chosen();
      if (choice?.kind === "branch") void remove(choice.branch);
      return;
    }
    const action = queryActionFor(key);
    if (action === null) return;
    switch (action.kind) {
      case "close":
        props.onClose();
        return;
      case "choose": {
        const choice = chosen();
        if (choice === undefined) return;
        void act(() =>
          choice.kind === "create" ? props.onCreate(choice.name) : props.onSwitch(choice.branch),
        );
        return;
      }
      case "move":
        if (choices().length > 0) setSelected((i) => cycle(i, action.delta, choices().length));
        setNote(null);
        return;
      case "erase":
        editQuery(
          action.unit === "char"
            ? eraseChar(query())
            : action.unit === "word"
              ? eraseWord(query())
              : "",
        );
        return;
      case "type":
        editQuery(query() + action.text);
        return;
      default:
        assertNever(action);
    }
  });

  usePaste((event) => {
    if (!busy()) editQuery(query() + pastedText(new TextDecoder().decode(event.bytes)));
  });

  const ascii = () => props.icons === "ascii";
  const width = () => dialogWidth(dimensions().width);
  const everything = createMemo(() => branchRows(branches(), "", props.suggested ?? null).length);
  const listHeight = () => dialogListRows(dimensions().height, everything());
  const visibleRows = () => {
    const choice = chosen();
    const at = choice === undefined ? 0 : rows().indexOf(choice);
    const offset = scrollOffset(at, rows().length, listHeight());
    return rows().slice(offset, offset + listHeight());
  };

  /** Where a branch stands against its upstream, in a few columns. */
  const drift = (branch: Branch) => {
    if (branch.gone) return "gone";
    const parts = [
      branch.ahead > 0 ? `${ascii() ? "+" : "↑"}${branch.ahead}` : "",
      branch.behind > 0 ? `${ascii() ? "-" : "↓"}${branch.behind}` : "",
    ].filter((part) => part !== "");
    return parts.join(" ");
  };

  const footer = () => {
    const choice = chosen();
    const enter = choice?.kind === "create" ? "enter create" : "enter switch";
    return `${enter}  ctrl+d delete  esc close`;
  };

  return (
    <Dialog title=" Branches " width={width()}>
      <text>
        <span style={{ fg: PALETTE.accentPrimary }}>{"> "}</span>
        <span style={{ fg: PALETTE.text }}>{query()}</span>
        <span style={{ fg: PALETTE.cursor }}>{ascii() ? "_" : "▏"}</span>
      </text>
      <box height={listHeight()} flexDirection="column">
        <Switch>
          <Match when={loaded() === null}>
            <text fg={PALETTE.textMuted}>Reading branches...</text>
          </Match>
          <Match when={failure()}>
            {(shown: Accessor<AppError>) => <ErrorLine error={shown()} ascii={ascii()} />}
          </Match>
          <Match when={rows().length === 0}>
            <text fg={PALETTE.textMuted}>{`No branch matches "${query().trim()}"`}</text>
          </Match>
          <Match when={true}>
            <For each={visibleRows()}>
              {(row) => {
                if (row.kind === "heading") {
                  return (
                    <text fg={PALETTE.accentTertiary}>
                      <b>{row.label}</b>
                    </text>
                  );
                }
                const active = () => chosen() === row;
                const marker = () => (active() ? (ascii() ? "> " : "▸ ") : "  ");
                return (
                  <box backgroundColor={active() ? PALETTE.selectionBg : PALETTE.panelBg}>
                    <text>
                      <span style={{ fg: PALETTE.borderFocused }}>{marker()}</span>
                      {row.kind === "create" ? (
                        <>
                          <span style={{ fg: PALETTE.success }}>{"+ Create "}</span>
                          <span style={{ fg: active() ? PALETTE.selectionFg : PALETTE.text }}>
                            {/* The frame, padding, marker and the words around the name. */}
                            <b>{truncateToWidth(row.name, Math.max(1, width() - 20))}</b>
                          </span>
                          <span style={{ fg: PALETTE.textMuted }}>{" here"}</span>
                        </>
                      ) : (
                        <>
                          <Highlighted
                            text={row.branch.name}
                            hits={row.hits}
                            fg={active() ? PALETTE.selectionFg : PALETTE.text}
                            bold={active()}
                          />
                          <Show when={row.branch.current}>
                            <span style={{ fg: PALETTE.success }}>
                              {ascii() ? "  * current" : "  ● current"}
                            </span>
                          </Show>
                          <Show when={drift(row.branch) !== ""}>
                            <span
                              style={{ fg: row.branch.gone ? PALETTE.warning : PALETTE.accentSoul }}
                            >
                              {`  ${drift(row.branch)}`}
                            </span>
                          </Show>
                          <span style={{ fg: PALETTE.textMuted }}>
                            {`  ${truncateToWidth(
                              row.branch.subject,
                              Math.max(
                                1,
                                width() -
                                  8 -
                                  Bun.stringWidth(row.branch.name) -
                                  (row.branch.current ? 11 : 0) -
                                  (drift(row.branch) === "" ? 0 : drift(row.branch).length + 2),
                              ),
                            )}`}
                          </span>
                        </>
                      )}
                    </text>
                  </box>
                );
              }}
            </For>
          </Match>
        </Switch>
      </box>
      <Show when={error()}>
        {(shown: Accessor<AppError>) => <ErrorLine error={shown()} ascii={ascii()} />}
      </Show>
      <Show when={note()}>
        {(shown: Accessor<Note>) => <text fg={PALETTE[shown().tone]}>{shown().text}</text>}
      </Show>
      <text fg={PALETTE.textMuted}>{busy() ? "Working..." : footer()}</text>
    </Dialog>
  );
}
