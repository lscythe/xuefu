import { type Accessor, type JSX, Show } from "solid-js";
import { PALETTE } from "./theme/palette";

export interface PanelProps {
  /** Left out of the border when empty. */
  readonly title: string;
  /** The key that focuses the panel, shown before the title. */
  readonly number?: number;
  /** A count or state, set into the right of the top border. */
  readonly status?: string | null;
  /** Keys that act on the panel, set into the bottom border while it has focus. */
  readonly keys?: string | null;
  readonly focused: boolean;
  readonly width?: number;
  readonly height?: number;
  readonly flexGrow?: number;
  readonly children: JSX.Element;
}

/**
 * A rounded frame with its title in the top border. Only the focused panel is lit, so the eye
 * goes to one place, and that panel carries its own keys where it is being looked at.
 */
export function Panel(props: PanelProps) {
  const tone = () => (props.focused ? PALETTE.borderFocused : PALETTE.borderIdle);
  const title = () => {
    const words = [props.number, props.title].filter((word) => word !== undefined && word !== "");
    return words.length === 0 ? "" : ` ${words.join(" ")} `;
  };
  return (
    <box
      border
      borderStyle="rounded"
      borderColor={tone()}
      title={title()}
      titleColor={props.focused ? PALETTE.borderFocused : PALETTE.textMuted}
      bottomTitle={props.focused && props.keys ? ` ${props.keys} ` : ""}
      bottomTitleAlignment="center"
      flexDirection="column"
      paddingX={1}
      backgroundColor={PALETTE.bg}
      {...(props.width === undefined ? {} : { width: props.width })}
      {...(props.height === undefined ? {} : { height: props.height })}
      {...(props.flexGrow === undefined ? {} : { flexGrow: props.flexGrow })}
    >
      <Show when={props.status}>
        {(status: Accessor<string>) => (
          <text
            position="absolute"
            top={-1}
            right={1}
            fg={props.focused ? PALETTE.borderFocused : PALETTE.textMuted}
            bg={PALETTE.bg}
          >
            {` ${status()} `}
          </text>
        )}
      </Show>
      {props.children}
    </box>
  );
}
