import type { PaletteToken } from "./palette";

export type IconSet = "nerd" | "unicode" | "ascii";

export type StatusKind = "success" | "failed" | "running" | "pending" | "cancelled" | "unknown";

export interface StatusPresentation {
  readonly label: string;
  readonly tone: PaletteToken;
  readonly glyphs: { readonly unicode: string; readonly ascii: string };
}

/** State is always shown as glyph + label + colour, so it survives colour blindness and NO_COLOR. */
export const STATUS_PRESENTATION: Readonly<Record<StatusKind, StatusPresentation>> = {
  success: { label: "SUCCESS", tone: "success", glyphs: { unicode: "✓", ascii: "[ok]" } },
  failed: { label: "FAILED", tone: "error", glyphs: { unicode: "✗", ascii: "[x]" } },
  running: { label: "RUNNING", tone: "busy", glyphs: { unicode: "◉", ascii: "[*]" } },
  pending: { label: "PENDING", tone: "textMuted", glyphs: { unicode: "○", ascii: "[ ]" } },
  cancelled: { label: "CANCELLED", tone: "warning", glyphs: { unicode: "⊘", ascii: "[-]" } },
  unknown: { label: "UNKNOWN", tone: "textMuted", glyphs: { unicode: "?", ascii: "[?]" } },
};

export function statusGlyph(status: StatusKind, icons: IconSet): string {
  const { glyphs } = STATUS_PRESENTATION[status];
  return icons === "ascii" ? glyphs.ascii : glyphs.unicode;
}
