import { useKeyboard, usePaste, useTerminalDimensions } from "@opentui/solid";
import { type Accessor, createMemo, createSignal, For, onCleanup, Show } from "solid-js";
import type { AppError } from "../../application/errors";
import type { AgentChoosing } from "../../application/ports/agent";
import { assertNever } from "../../domain/shared/assert-never";
import { Dialog, dialogListRows, dialogWidth } from "../dialog";
import { ErrorLine } from "../error-line";
import { Highlighted } from "../highlighted";
import { cycle, scrollOffset } from "../list-navigation";
import { eraseChar, eraseWord, pastedText } from "../query-input/edit";
import { queryActionFor } from "../query-input/keys";
import { PALETTE } from "../theme/palette";
import type { IconSet } from "../theme/status";
import { type AgentModels, type PickerRow, pickerRows, sameChoice } from "./agent-picker-model";

export interface AgentPickerProps {
  readonly choosing: AgentChoosing;
  readonly icons: IconSet;
  readonly onClose: () => void;
}

type ModelRow = Extract<PickerRow, { kind: "model" }>;
const isModel = (row: PickerRow): row is ModelRow => row.kind === "model";

/**
 * Chooses which agent answers and on which model: every agent installed, each with the models it
 * can run, found out as the picker opens. Typing filters them; Enter keeps the choice for the
 * conversations after, and for the next run of XueFu.
 */
export function AgentPicker(props: AgentPickerProps) {
  const dimensions = useTerminalDimensions();
  const current = props.choosing.current();
  const [agents, setAgents] = createSignal<readonly AgentModels[]>(
    props.choosing.agents().map((agent) => ({ ...agent, models: null })),
  );
  const [query, setQuery] = createSignal("");
  const [selected, setSelected] = createSignal(0);
  const [failure, setFailure] = createSignal<AppError | null>(null);

  const rows = createMemo(() => pickerRows(agents(), query()));
  const choices = createMemo(() => rows().filter(isModel));

  const finding = new AbortController();
  onCleanup(() => finding.abort());
  for (const agent of props.choosing.agents()) {
    void props.choosing.models(agent.id, finding.signal).then((models) => {
      if (finding.signal.aborted) return;
      const before = choices()[selected()]?.choice;
      setAgents((all) => all.map((one) => (one.id === agent.id ? { ...one, models } : one)));
      // Stay on the model chosen as more are found: the one in use, until another is picked.
      const keep = before ?? current;
      setSelected(
        Math.max(
          0,
          choices().findIndex((row) => sameChoice(row.choice, keep)),
        ),
      );
    });
  }

  const editQuery = (next: string) => {
    setQuery(next);
    setSelected(0);
    setFailure(null);
  };

  useKeyboard((key) => {
    const action = queryActionFor(key);
    if (action === null) return;
    switch (action.kind) {
      case "close":
        props.onClose();
        return;
      case "choose": {
        const row = choices()[selected()];
        if (row === undefined) return;
        const chosen = props.choosing.choose(row.choice);
        if (chosen.ok) props.onClose();
        else setFailure(chosen.error);
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

  const ascii = () => props.icons === "ascii";
  const everything = createMemo(() => pickerRows(agents(), "").length);
  const listHeight = () => dialogListRows(dimensions().height, everything());
  const selectedRow = () => {
    const choice = choices()[selected()];
    return choice === undefined ? 0 : rows().indexOf(choice);
  };
  const visibleRows = () => {
    const offset = scrollOffset(selectedRow(), rows().length, listHeight());
    return rows().slice(offset, offset + listHeight());
  };
  const known = () => agents().flatMap((agent) => (agent.models?.ok ? agent.models.value : []));

  return (
    <Dialog title=" Agent and model " width={dialogWidth(dimensions().width)}>
      <text>
        <span style={{ fg: PALETTE.accentPrimary }}>{"> "}</span>
        <span style={{ fg: PALETTE.text }}>{query()}</span>
        <span style={{ fg: PALETTE.cursor }}>{ascii() ? "_" : "▏"}</span>
      </text>
      <box height={listHeight()} flexDirection="column">
        <Show
          when={rows().length > 0}
          fallback={<text fg={PALETTE.textMuted}>{`No model matches "${query().trim()}"`}</text>}
        >
          <For each={visibleRows()}>
            {(row) => {
              switch (row.kind) {
                case "agent":
                  return (
                    <text fg={PALETTE.accentTertiary}>
                      <b>{row.name}</b>
                    </text>
                  );
                case "note":
                  return (
                    <text fg={row.failed ? PALETTE.error : PALETTE.textMuted}>
                      {`  ${row.text}`}
                    </text>
                  );
                case "model": {
                  const active = () => choices()[selected()] === row;
                  return (
                    <box backgroundColor={active() ? PALETTE.selectionBg : PALETTE.panelBg}>
                      <text>
                        <span style={{ fg: PALETTE.borderFocused }}>
                          {active() ? (ascii() ? "> " : "▸ ") : "  "}
                        </span>
                        <Highlighted
                          text={row.name}
                          hits={row.hits}
                          fg={active() ? PALETTE.selectionFg : PALETTE.text}
                          bold={active()}
                        />
                        <Show when={sameChoice(row.choice, current)}>
                          <span style={{ fg: PALETTE.success }}>
                            {ascii() ? "  * current" : "  ● current"}
                          </span>
                        </Show>
                      </text>
                    </box>
                  );
                }
                default:
                  return assertNever(row);
              }
            }}
          </For>
        </Show>
      </box>
      <Show when={failure()}>
        {(error: Accessor<AppError>) => <ErrorLine error={error()} ascii={ascii()} />}
      </Show>
      <text fg={PALETTE.textMuted}>
        {`${choices().length} of ${known().length}   `}
        {ascii() ? "up/down move" : "↑↓ move"}
        {"  enter choose  esc close"}
      </text>
    </Dialog>
  );
}
