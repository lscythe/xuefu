import { useKeyboard, usePaste, useTerminalDimensions } from "@opentui/solid";
import { type Accessor, createMemo, createSignal, For, Match, Show, Switch } from "solid-js";
import type { AppError } from "../../application/errors";
import type { WorkspaceView } from "../../application/workspace/queries";
import { assertNever } from "../../domain/shared/assert-never";
import type { WorkspaceId } from "../../domain/shared/ids";
import type { Result } from "../../domain/shared/result";
import type { Workspace } from "../../domain/workspace/workspace";
import { segments } from "../highlight";
import { cycle } from "../list-navigation";
import { PALETTE } from "../theme/palette";
import type { IconSet } from "../theme/status";
import { switcherActionFor } from "./switcher-keys";
import {
  eraseChar,
  eraseWord,
  pastedText,
  type SwitcherRow,
  scrollOffset,
  switcherRows,
} from "./switcher-model";

export interface SwitcherProps {
  /** Read fresh on every open, so workspaces added from the CLI meanwhile show up. */
  readonly load: () => Promise<Result<readonly WorkspaceView[], AppError>>;
  readonly currentId: WorkspaceId | null;
  readonly icons: IconSet;
  /** Switches to the workspace; on failure the switcher stays open and shows the error. */
  readonly onChoose: (workspace: Workspace) => Promise<Result<unknown, AppError>>;
  readonly onClose: () => void;
}

type WorkspaceRow = Extract<SwitcherRow, { kind: "workspace" }>;
const isWorkspaceRow = (row: SwitcherRow): row is WorkspaceRow => row.kind === "workspace";

const MAX_WIDTH = 64;
const MAX_LIST_ROWS = 12;

function Highlighted(props: { text: string; hits: readonly number[]; fg: string; bold?: boolean }) {
  return (
    <For each={segments(props.text, props.hits)}>
      {(part) =>
        part.hit ? (
          <span style={{ fg: PALETTE.accentSpectral }}>
            <b>{part.text}</b>
          </span>
        ) : props.bold === true ? (
          <span style={{ fg: props.fg }}>
            <b>{part.text}</b>
          </span>
        ) : (
          <span style={{ fg: props.fg }}>{part.text}</span>
        )
      }
    </For>
  );
}

/** Error text stays Bone White beside a vermilion glyph: vermilion text is too low-contrast. */
function ErrorLine(props: { error: AppError; ascii: boolean }) {
  return (
    <text>
      <span style={{ fg: PALETTE.error }}>{props.ascii ? "[x] " : "✗ "}</span>
      <span style={{ fg: PALETTE.text }}>{props.error.message}</span>
    </text>
  );
}

export function Switcher(props: SwitcherProps) {
  const dimensions = useTerminalDimensions();
  const [loaded, setLoaded] = createSignal<Result<readonly WorkspaceView[], AppError> | null>(null);
  const [query, setQuery] = createSignal("");
  const [selected, setSelected] = createSignal(0);
  const [choosing, setChoosing] = createSignal(false);
  const [chooseError, setChooseError] = createSignal<AppError | null>(null);

  const views = () => {
    const result = loaded();
    return result?.ok === true ? result.value : [];
  };
  const failure = () => {
    const result = loaded();
    return result?.ok === false ? result.error : null;
  };
  const rows = createMemo(() => switcherRows(views(), query()));
  const choices = createMemo(() => rows().filter(isWorkspaceRow));

  void props.load().then((result) => {
    setLoaded(result);
    // Open on the current workspace, so Enter right away keeps you where you are.
    const current = choices().findIndex((row) => row.view.workspace.id === props.currentId);
    setSelected(Math.max(0, current));
  });

  const editQuery = (next: string) => {
    setQuery(next);
    setSelected(0);
    setChooseError(null);
  };

  const choose = async (workspace: Workspace) => {
    if (choosing()) return;
    setChoosing(true);
    const chosen = await props.onChoose(workspace);
    setChoosing(false);
    setChooseError(chosen.ok ? null : chosen.error);
  };

  useKeyboard((key) => {
    const action = switcherActionFor(key);
    if (action === null) return;
    switch (action.kind) {
      case "close":
        props.onClose();
        return;
      case "choose": {
        const choice = choices()[selected()];
        if (choice !== undefined) void choose(choice.view.workspace);
        return;
      }
      case "move":
        if (choices().length > 0) setSelected((i) => cycle(i, action.delta, choices().length));
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
    editQuery(query() + pastedText(new TextDecoder().decode(event.bytes)));
  });

  const width = () => Math.min(MAX_WIDTH, dimensions().width - 4);
  const listHeight = () => Math.max(3, Math.min(MAX_LIST_ROWS, dimensions().height - 10));
  const selectedRow = () => {
    const choice = choices()[selected()];
    return choice === undefined ? 0 : rows().indexOf(choice);
  };
  const visibleRows = () => {
    const offset = scrollOffset(selectedRow(), rows().length, listHeight());
    return rows().slice(offset, offset + listHeight());
  };

  const ascii = () => props.icons === "ascii";

  return (
    <box
      position="absolute"
      zIndex={10}
      top={2}
      left={Math.max(0, Math.floor((dimensions().width - width()) / 2))}
      width={width()}
      flexDirection="column"
      border
      borderColor={PALETTE.borderFocused}
      // panelBg, not elevatedBg: the selection colour is elevatedBg's twin and would vanish.
      backgroundColor={PALETTE.panelBg}
      title=" Switch workspace "
      titleColor={PALETTE.accentSecondary}
      paddingX={1}
    >
      <text>
        <span style={{ fg: PALETTE.accentPrimary }}>{"> "}</span>
        <span style={{ fg: PALETTE.text }}>{query()}</span>
        <span style={{ fg: PALETTE.cursor }}>{ascii() ? "_" : "▏"}</span>
      </text>
      <Switch>
        <Match when={loaded() === null}>
          <text fg={PALETTE.textMuted}>Loading workspaces...</text>
        </Match>
        <Match when={failure()}>
          {(error: Accessor<AppError>) => <ErrorLine error={error()} ascii={ascii()} />}
        </Match>
        <Match when={views().length === 0}>
          <text fg={PALETTE.textMuted}>No workspaces yet. Add one with:</text>
          <text fg={PALETTE.text}>{"  xuefu workspace add [path]"}</text>
        </Match>
        <Match when={rows().length === 0}>
          <text fg={PALETTE.textMuted}>{`No workspace matches "${query().trim()}"`}</text>
        </Match>
        <Match when={true}>
          <For each={visibleRows()}>
            {(row) => {
              if (row.kind === "group") {
                return (
                  <text fg={PALETTE.accentTertiary}>
                    <b>{row.label}</b>
                  </text>
                );
              }
              const active = () => choices()[selected()] === row;
              const workspace = row.view.workspace;
              return (
                <box backgroundColor={active() ? PALETTE.selectionBg : PALETTE.panelBg}>
                  <text>
                    <span style={{ fg: PALETTE.borderFocused }}>
                      {active() ? (ascii() ? "> " : "▸ ") : "  "}
                    </span>
                    <Highlighted
                      text={workspace.name}
                      hits={row.nameHits}
                      fg={active() ? PALETTE.selectionFg : PALETTE.text}
                      bold={active()}
                    />
                    <span>{"  "}</span>
                    <Highlighted text={workspace.id} hits={row.idHits} fg={PALETTE.textMuted} />
                    <Show when={workspace.id === props.currentId}>
                      <span style={{ fg: PALETTE.success }}>
                        {ascii() ? "  * current" : "  ● current"}
                      </span>
                    </Show>
                    <Show when={row.view.status === "missing"}>
                      <span style={{ fg: PALETTE.warning }}>
                        {ascii() ? "  ! missing" : "  ⚠ missing"}
                      </span>
                    </Show>
                  </text>
                </box>
              );
            }}
          </For>
        </Match>
      </Switch>
      <Show when={chooseError()}>
        {(error: Accessor<AppError>) => <ErrorLine error={error()} ascii={ascii()} />}
      </Show>
      <text fg={PALETTE.textMuted}>
        {`${choices().length} of ${views().length}   `}
        {ascii() ? "up/down move" : "↑↓ move"}
        {"  enter switch  esc close"}
      </text>
    </box>
  );
}
