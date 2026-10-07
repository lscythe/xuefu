import { For } from "solid-js";
import { segments } from "./highlight";
import { PALETTE } from "./theme/palette";

/** Text with fuzzy-matched characters picked out in the spectral accent. */
export function Highlighted(props: {
  text: string;
  hits: readonly number[];
  fg: string;
  bold?: boolean;
}) {
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
