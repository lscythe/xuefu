export type HexColor = `#${string}`;

/**
 * 血符 palette: slate surfaces, lavender for what is selected, peach for what has focus, and the
 * vermilion mark kept for the brand and errors. Plain hex so it stays renderer-agnostic; convert
 * with `RGBA.fromHex` at the OpenTUI boundary. Contrast rules for these tokens are enforced by
 * tests.
 */
export const PALETTE = {
  // Surfaces
  bg: "#1c1d29", // Slate
  panelBg: "#272939", // Raised Slate: the key bar and overlays
  elevatedBg: "#2f3146", // Lifted Slate
  stripeBg: "#212232", // Every other row of a list

  // Text
  text: "#dadcea", // Mist
  textMuted: "#9a9db6", // Haze
  textDim: "#585b75", // Dusk: decorative only, never for information
  textInverse: "#1c1d29", // Slate, on filled badges and selections

  // Accents
  accentPrimary: "#e8685c", // Vermilion: the 血符 mark
  accentSecondary: "#b8a6f6", // Lavender: issue keys, the tab in front, table headings
  accentTertiary: "#f2a774", // Peach: focus and keys
  accentSpectral: "#86adf2", // Cornflower: matched text
  accentSoul: "#e48bd0", // Orchid

  // Semantic
  success: "#8fd3a4", // Jade
  warning: "#e8c46a", // Amber
  error: "#e8685c", // Vermilion
  info: "#86adf2", // Cornflower
  busy: "#e48bd0", // Orchid

  // Chrome
  borderFocused: "#f2a774", // Peach
  borderIdle: "#3d405a", // Slate Line
  cursor: "#b8a6f6", // Lavender
  selectionBg: "#332f52", // Lavender Shade: the chosen row of a list
  selectionFg: "#dadcea", // Mist
} as const satisfies Record<string, HexColor>;

export type PaletteToken = keyof typeof PALETTE;

/** Colours for things told apart only by colour, such as the issues in a breakdown, in order. */
export const SERIES: readonly HexColor[] = [
  PALETTE.accentTertiary,
  PALETTE.info,
  PALETTE.accentSoul,
  PALETTE.success,
  PALETTE.accentSecondary,
  PALETTE.warning,
];
