import { useKeyboard, useTerminalDimensions } from "@opentui/solid";
import { createSignal, Show } from "solid-js";
import type { Clock } from "../../application/ports/clock";
import { assertNever } from "../../domain/shared/assert-never";
import { PALETTE } from "../theme/palette";
import type { IconSet } from "../theme/status";
import { Header } from "./header";
import { KeyBar } from "./key-bar";
import { actionFor, keyHints } from "./keymap";
import { Nav } from "./nav";
import { cycle, SECTIONS } from "./sections";
import { fitsTerminal } from "./terminal-size";
import { TooSmall } from "./too-small";

export interface ShellProps {
  readonly clock: Clock;
  readonly icons: IconSet;
  /** Display name of the workspace XueFu was opened in, or null outside every workspace. */
  readonly workspaceName: string | null;
  readonly onQuit: () => void;
  /** IANA zone for the header clock; the host zone when omitted. */
  readonly timeZone?: string;
  readonly tickMs?: number;
}

export function Shell(props: ShellProps) {
  const dimensions = useTerminalDimensions();
  const [selected, setSelected] = createSignal(0);
  const section = () => SECTIONS[selected()] ?? SECTIONS[0];

  useKeyboard((key) => {
    const action = actionFor(key);
    switch (action) {
      case null:
        return;
      case "nav.previous":
        setSelected((i) => cycle(i, -1, SECTIONS.length));
        return;
      case "nav.next":
        setSelected((i) => cycle(i, 1, SECTIONS.length));
        return;
      case "nav.first":
        setSelected(0);
        return;
      case "nav.last":
        setSelected(SECTIONS.length - 1);
        return;
      case "quit":
        props.onQuit();
        return;
      default:
        assertNever(action);
    }
  });

  return (
    <box flexDirection="column" width="100%" height="100%" backgroundColor={PALETTE.bg}>
      <Show
        when={fitsTerminal(dimensions().width, dimensions().height)}
        fallback={<TooSmall width={dimensions().width} height={dimensions().height} />}
      >
        <Header
          clock={props.clock}
          timeZone={props.timeZone}
          tickMs={props.tickMs ?? 1000}
          icons={props.icons}
          workspaceName={props.workspaceName}
        />
        <box flexDirection="row" flexGrow={1}>
          <Nav selected={selected()} icons={props.icons} />
          <box
            flexGrow={1}
            flexDirection="column"
            border
            borderColor={PALETTE.borderFocused}
            paddingX={1}
          >
            <text fg={PALETTE.accentSecondary}>
              <b>{`▍${section()?.label.toUpperCase()}`}</b>
            </text>
            <text fg={PALETTE.textMuted}>Nothing to show yet.</text>
          </box>
        </box>
        <KeyBar hints={keyHints(props.icons)} />
      </Show>
    </box>
  );
}
