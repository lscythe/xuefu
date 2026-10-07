import { useKeyboard, usePaste, useTerminalDimensions } from "@opentui/solid";
import { type Accessor, createMemo, createSignal, For, Index, Match, Show, Switch } from "solid-js";
import type { AppError } from "../../application/errors";
import { assertNever } from "../../domain/shared/assert-never";
import { ErrorLine } from "../error-line";
import { Highlighted } from "../highlighted";
import { cycle, scrollOffset } from "../list-navigation";
import { eraseChar, eraseWord, pastedText } from "../query-input/edit";
import { queryActionFor } from "../query-input/keys";
import { PALETTE } from "../theme/palette";
import type { IconSet } from "../theme/status";
import { fieldValue, type PaletteEntry, paletteRows } from "./palette-model";

export interface PaletteProps {
  /** What can be done right now; the caller leaves out what does not apply. */
  readonly entries: readonly PaletteEntry[];
  readonly icons: IconSet;
  readonly onClose: () => void;
}

/** Choosing an entry, or filling in the fields of the chosen one. */
type Stage =
  | { readonly kind: "choose" }
  | {
      readonly kind: "ask";
      readonly entry: PaletteEntry;
      /** Values of the fields before the current one. */
      readonly values: readonly (string | null)[];
    };

const MAX_WIDTH = 64;
const MAX_LIST_ROWS = 12;
/** Border and padding on both sides, plus a column so keys stand clear of the border. */
const CHROME = 5;
/** "▸ " before each title. */
const MARKER = 2;

const titleOf = (entry: PaletteEntry) =>
  entry.fields.length > 0 ? `${entry.title}…` : entry.title;

/** The command palette: find an action by name and run it, asking for any input it needs. */
export function Palette(props: PaletteProps) {
  const dimensions = useTerminalDimensions();
  const [stage, setStage] = createSignal<Stage>({ kind: "choose" });
  const [query, setQuery] = createSignal("");
  const [input, setInput] = createSignal("");
  const [selected, setSelected] = createSignal(0);
  const [error, setError] = createSignal<AppError | null>(null);
  const [running, setRunning] = createSignal(false);

  const rows = createMemo(() => paletteRows(props.entries, query()));
  const asking = () => {
    const current = stage();
    return current.kind === "ask" ? current : null;
  };
  const field = () => {
    const current = asking();
    return current === null ? null : (current.entry.fields[current.values.length] ?? null);
  };

  const run = async (entry: PaletteEntry, values: readonly (string | null)[]) => {
    if (running()) return;
    setRunning(true);
    const ran = await entry.run(values);
    setRunning(false);
    if (ran.ok) props.onClose();
    else setError(ran.error);
  };

  const choose = () => {
    const row = rows()[selected()];
    if (row === undefined) return;
    if (row.entry.fields.length === 0) {
      void run(row.entry, []);
      return;
    }
    setStage({ kind: "ask", entry: row.entry, values: [] });
    setInput("");
  };

  const submit = () => {
    const current = asking();
    const asked = field();
    if (current === null || asked === null) return;
    const value = fieldValue(asked, input());
    if (!value.ok) {
      setError(value.error);
      return;
    }
    const values = [...current.values, value.value];
    if (values.length < current.entry.fields.length) {
      setStage({ ...current, values });
      setInput("");
      return;
    }
    void run(current.entry, values);
  };

  const edit = (next: (text: string) => string) => {
    setError(null);
    if (asking() === null) {
      setQuery(next(query()));
      setSelected(0);
    } else {
      setInput(next(input()));
    }
  };

  useKeyboard((key) => {
    const action = queryActionFor(key);
    if (action === null) return;
    switch (action.kind) {
      case "close":
        // Esc steps back out of the fields to the list before it closes the palette.
        if (asking() === null) props.onClose();
        else {
          setStage({ kind: "choose" });
          setError(null);
        }
        return;
      case "choose":
        if (asking() === null) choose();
        else submit();
        return;
      case "move":
        if (asking() === null && rows().length > 0) {
          setSelected((i) => cycle(i, action.delta, rows().length));
        }
        return;
      case "erase":
        edit(action.unit === "char" ? eraseChar : action.unit === "word" ? eraseWord : () => "");
        return;
      case "type":
        edit((text) => text + action.text);
        return;
      default:
        assertNever(action);
    }
  });

  usePaste((event) => {
    const text = pastedText(new TextDecoder().decode(event.bytes));
    edit((current) => current + text);
  });

  const ascii = () => props.icons === "ascii";
  const width = () => Math.min(MAX_WIDTH, dimensions().width - 4);
  const listHeight = () => Math.max(3, Math.min(MAX_LIST_ROWS, dimensions().height - 10));
  const offset = () => scrollOffset(selected(), rows().length, listHeight());
  const cursor = () => (ascii() ? "_" : "▏");
  const gap = (entry: PaletteEntry) =>
    " ".repeat(
      Math.max(
        2,
        width() -
          CHROME -
          MARKER -
          Bun.stringWidth(titleOf(entry)) -
          Bun.stringWidth(entry.keys ?? ""),
      ),
    );

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
      title={` ${asking()?.entry.title ?? "Commands"} `}
      titleColor={PALETTE.accentSecondary}
      paddingX={1}
    >
      <Switch>
        <Match when={asking()}>
          {(current: Accessor<Extract<Stage, { kind: "ask" }>>) => (
            <>
              <Index each={current().values}>
                {(value, index) => (
                  <text>
                    <span style={{ fg: PALETTE.textMuted }}>
                      {`${current().entry.fields[index]?.label ?? ""}  `}
                    </span>
                    <span style={{ fg: PALETTE.text }}>{value() ?? "-"}</span>
                  </text>
                )}
              </Index>
              <text fg={PALETTE.textMuted}>
                {field()?.label ?? ""}
                {field()?.optional === true ? " (optional)" : ""}
              </text>
              <text>
                <span style={{ fg: PALETTE.accentPrimary }}>{"> "}</span>
                <span style={{ fg: PALETTE.text }}>{input()}</span>
                <span style={{ fg: PALETTE.cursor }}>{cursor()}</span>
                <span style={{ fg: PALETTE.textDim }}>
                  {input() === "" ? `e.g. ${field()?.example ?? ""}` : ""}
                </span>
              </text>
            </>
          )}
        </Match>
        <Match when={true}>
          <text>
            <span style={{ fg: PALETTE.accentPrimary }}>{": "}</span>
            <span style={{ fg: PALETTE.text }}>{query()}</span>
            <span style={{ fg: PALETTE.cursor }}>{cursor()}</span>
          </text>
          <Show
            when={rows().length > 0}
            fallback={
              <text fg={PALETTE.textMuted}>{`No command matches "${query().trim()}"`}</text>
            }
          >
            <For each={rows().slice(offset(), offset() + listHeight())}>
              {(row) => {
                const active = () => rows()[selected()] === row;
                return (
                  <box backgroundColor={active() ? PALETTE.selectionBg : PALETTE.panelBg}>
                    <text>
                      <span style={{ fg: PALETTE.borderFocused }}>
                        {active() ? (ascii() ? "> " : "▸ ") : "  "}
                      </span>
                      <Highlighted
                        text={titleOf(row.entry)}
                        hits={row.hits}
                        fg={active() ? PALETTE.selectionFg : PALETTE.text}
                        bold={active()}
                      />
                      <span style={{ fg: PALETTE.textMuted }}>
                        {`${gap(row.entry)}${row.entry.keys ?? ""}`}
                      </span>
                    </text>
                  </box>
                );
              }}
            </For>
          </Show>
        </Match>
      </Switch>
      <Show when={error()}>
        {(shown: Accessor<AppError>) => <ErrorLine error={shown()} ascii={ascii()} />}
      </Show>
      <text fg={PALETTE.textMuted}>
        {asking() === null
          ? `${ascii() ? "up/down" : "↑↓"} move  enter run  esc close`
          : "enter next  esc back"}
      </text>
    </box>
  );
}
