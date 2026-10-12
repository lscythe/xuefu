import { truncateToWidth } from "./shell/tab-labels";
import { PALETTE } from "./theme/palette";
import { type IconSet, statusGlyph } from "./theme/status";

/** A line above a section's list: what is running, how it went, or what did not. */
export interface Banner {
  readonly kind: "running" | "success" | "warning";
  readonly text: string;
}

export function BannerLine(props: {
  readonly banner: Banner;
  readonly width: number;
  readonly icons: IconSet;
}) {
  const tone = () =>
    props.banner.kind === "running"
      ? PALETTE.busy
      : props.banner.kind === "success"
        ? PALETTE.success
        : PALETTE.warning;
  const glyph = () =>
    props.banner.kind === "warning"
      ? props.icons === "ascii"
        ? "[!]"
        : "⚠"
      : statusGlyph(props.banner.kind, props.icons);
  return (
    <text>
      <span style={{ fg: tone() }}>{`${glyph()} `}</span>
      <span style={{ fg: PALETTE.text }}>
        {truncateToWidth(props.banner.text, props.width - 2)}
      </span>
    </text>
  );
}
