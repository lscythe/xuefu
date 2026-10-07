import { useKeyboard, useTerminalDimensions } from "@opentui/solid";
import { type Accessor, createSignal, Show } from "solid-js";
import type { AppError } from "../../application/errors";
import type { Clock } from "../../application/ports/clock";
import type { OpenTabs, WorkspaceView } from "../../application/workspace/queries";
import { assertNever } from "../../domain/shared/assert-never";
import type { Result } from "../../domain/shared/result";
import type { Workspace } from "../../domain/workspace/workspace";
import { ErrorLine } from "../error-line";
import { cycle } from "../list-navigation";
import { Switcher } from "../switcher/switcher";
import { PALETTE } from "../theme/palette";
import type { IconSet } from "../theme/status";
import { Header } from "./header";
import { KeyBar } from "./key-bar";
import { actionFor, keyHints } from "./keymap";
import { Nav } from "./nav";
import { SECTIONS } from "./sections";
import { TabBar } from "./tab-bar";
import { fitsTerminal } from "./terminal-size";
import { TooSmall } from "./too-small";

export interface ShellProps {
  readonly clock: Clock;
  readonly icons: IconSet;
  /** Tabs to start with; the header shows the one in front. */
  readonly tabs: OpenTabs;
  readonly loadWorkspaces: () => Promise<Result<readonly WorkspaceView[], AppError>>;
  /** Brings the workspace to the front, opening a tab for it if needed, and saves that. */
  readonly activateWorkspace: (workspace: Workspace) => Promise<Result<OpenTabs, AppError>>;
  readonly closeTab: (workspace: Workspace) => Promise<Result<OpenTabs, AppError>>;
  readonly onQuit: () => void;
  /** IANA zone for the header clock; the host zone when omitted. */
  readonly timeZone?: string;
  readonly tickMs?: number;
}

export function Shell(props: ShellProps) {
  const dimensions = useTerminalDimensions();
  const [tabs, setTabs] = createSignal(props.tabs);
  const [switcherOpen, setSwitcherOpen] = createSignal(false);
  const [notice, setNotice] = createSignal<AppError | null>(null);
  // Each workspace keeps its own place in the navigation; "" is the no-workspace screen.
  const [sections, setSections] = createSignal<ReadonlyMap<string, number>>(new Map());

  const workspace = () => tabs().active;
  const selected = () => sections().get(workspace()?.id ?? "") ?? 0;
  const section = () => SECTIONS[selected()] ?? SECTIONS[0];
  const select = (index: number) =>
    setSections((current) => new Map(current).set(workspace()?.id ?? "", index));

  /** Applies a tab change once it is saved; a failure is shown above the key bar. */
  const changeTabs = async (change: Promise<Result<OpenTabs, AppError>>) => {
    const changed = await change;
    if (changed.ok) setTabs(changed.value);
    else setNotice(changed.error);
  };

  const move = (to: "previous" | "next" | "first" | "last") => {
    switch (to) {
      case "previous":
        return select(cycle(selected(), -1, SECTIONS.length));
      case "next":
        return select(cycle(selected(), 1, SECTIONS.length));
      case "first":
        return select(0);
      case "last":
        return select(SECTIONS.length - 1);
      default:
        return assertNever(to);
    }
  };

  useKeyboard((key) => {
    const action = actionFor(key);
    // An open overlay owns the keyboard; only Ctrl+C still reaches the shell.
    if (action === null || (switcherOpen() && action.kind !== "interrupt")) return;
    setNotice(null);
    switch (action.kind) {
      case "nav":
        move(action.to);
        return;
      case "switcher.open":
        setSwitcherOpen(true);
        return;
      case "tab.focus": {
        const target = tabs().open[action.position - 1];
        if (target !== undefined && target.id !== workspace()?.id) {
          void changeTabs(props.activateWorkspace(target));
        }
        return;
      }
      case "tab.close": {
        const current = workspace();
        if (current !== null) void changeTabs(props.closeTab(current));
        return;
      }
      case "quit":
      case "interrupt":
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
          workspaceName={workspace()?.name ?? null}
        />
        <Show when={tabs().open.length > 0}>
          <TabBar tabs={tabs()} width={dimensions().width} />
        </Show>
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
              <b>{`${props.icons === "ascii" ? "" : "▍"}${section()?.label.toUpperCase()}`}</b>
            </text>
            <text fg={PALETTE.textMuted}>Nothing to show yet.</text>
          </box>
        </box>
        <Show when={notice()}>
          {(error: Accessor<AppError>) => (
            <box paddingX={1} height={1} backgroundColor={PALETTE.panelBg}>
              <ErrorLine error={error()} ascii={props.icons === "ascii"} />
            </box>
          )}
        </Show>
        <KeyBar hints={keyHints(props.icons, { tabs: tabs().open.length > 0 })} />
        <Show when={switcherOpen()}>
          <Switcher
            load={props.loadWorkspaces}
            currentId={workspace()?.id ?? null}
            icons={props.icons}
            onChoose={async (chosen) => {
              const activated = await props.activateWorkspace(chosen);
              if (activated.ok) {
                setTabs(activated.value);
                setSwitcherOpen(false);
              }
              return activated;
            }}
            onClose={() => setSwitcherOpen(false)}
          />
        </Show>
      </Show>
    </box>
  );
}
