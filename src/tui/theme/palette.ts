export type HexColor = `#${string}`;

/**
 * 血符 palette. Plain hex so it stays renderer-agnostic; convert with `RGBA.fromHex` at the
 * OpenTUI boundary. Contrast rules for these tokens are enforced by tests.
 */
export const PALETTE = {
  // Surfaces
  bg: "#0a0a0f", // Ink Abyss
  panelBg: "#14141c", // Charcoal Jade
  elevatedBg: "#1c1626", // Nether Violet
  overlayBg: "#5c0a12", // Heartblood

  // Text
  text: "#e8e3d9", // Bone White
  textMuted: "#8a8578", // Ash Grey
  textDim: "#4a4740", // Grave Dust: decorative only, never for information
  textInverse: "#0a0a0f", // Ink Abyss

  // Accents
  accentPrimary: "#c1121f", // Blood Vermilion
  accentSecondary: "#7bdff2", // Ghost Fire
  accentTertiary: "#e0a458", // Talisman Gold
  accentSpectral: "#a6f0ff", // Spectral
  accentSoul: "#b14aed", // Soul Flame

  // Semantic
  success: "#4fd18b", // Jade Qi
  warning: "#e0a458", // Talisman Gold
  error: "#c1121f", // Blood Vermilion: glyphs, borders and badge backgrounds only
  info: "#7bdff2", // Ghost Fire
  busy: "#b14aed", // Soul Flame

  // Chrome
  borderFocused: "#c1121f", // Blood Vermilion
  borderIdle: "#4a4740", // Grave Dust
  cursor: "#7bdff2", // Ghost Fire
  selectionBg: "#1c1626", // Nether Violet
  selectionFg: "#e8e3d9", // Bone White
} as const satisfies Record<string, HexColor>;

export type PaletteToken = keyof typeof PALETTE;
