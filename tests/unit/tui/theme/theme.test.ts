import { describe, expect, test } from "bun:test";
import { contrastRatio } from "../../../../src/tui/theme/contrast";
import { PALETTE, type PaletteToken } from "../../../../src/tui/theme/palette";
import { STATUS_PRESENTATION, statusGlyph } from "../../../../src/tui/theme/status";

describe("contrastRatio", () => {
  test("matches WCAG reference values", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrastRatio("#ffffff", "#ffffff")).toBeCloseTo(1, 5);
    expect(contrastRatio("#777777", "#ffffff")).toBeCloseTo(4.48, 2);
  });

  test("is symmetric", () => {
    expect(contrastRatio("#c1121f", "#0a0a0f")).toBe(contrastRatio("#0a0a0f", "#c1121f"));
  });
});

describe("palette", () => {
  test("every token is a 6-digit hex colour", () => {
    for (const value of Object.values(PALETTE)) expect(value).toMatch(/^#[0-9a-f]{6}$/);
  });

  const surfaces: PaletteToken[] = ["bg", "panelBg", "elevatedBg"];
  const check = (fg: PaletteToken, bg: PaletteToken, minimum: number) =>
    expect(contrastRatio(PALETTE[fg], PALETTE[bg])).toBeGreaterThanOrEqual(minimum);

  test.each(surfaces)("body text is AAA (7:1) on %s", (surface) => check("text", surface, 7));

  test.each(surfaces)("muted text and accent text are AA (4.5:1) on %s", (surface) => {
    for (const token of [
      "textMuted",
      "accentSecondary",
      "accentTertiary",
      "accentSpectral",
      "success",
      "warning",
      "info",
    ] as const) {
      check(token, surface, 4.5);
    }
  });

  test.each(surfaces)("soul flame / busy meets the 3:1 non-text minimum on %s", (surface) => {
    check("accentSoul", surface, 3);
    check("busy", surface, 3);
  });

  test("blood vermilion is only used where 3:1 suffices: borders and glyphs on bg", () => {
    check("borderFocused", "bg", 3);
    check("error", "bg", 3);
    // Below 4.5:1, so error *messages* render in `text`, marked by a red glyph or badge.
    expect(contrastRatio(PALETTE.error, PALETTE.bg)).toBeLessThan(4.5);
  });

  test("badge pairings are readable", () => {
    check("text", "error", 4.5);
    check("textInverse", "success", 4.5);
    check("textInverse", "warning", 4.5);
    check("textInverse", "info", 4.5);
    check("text", "overlayBg", 7);
    check("selectionFg", "selectionBg", 7);
  });
});

describe("status presentation", () => {
  const statuses = Object.values(STATUS_PRESENTATION);

  test("every status has a glyph and a label, never colour alone", () => {
    for (const status of statuses) {
      expect(status.label).toMatch(/^[A-Z]+$/);
      expect(status.glyphs.unicode.length).toBeGreaterThan(0);
      expect(status.glyphs.ascii).toMatch(/^[\x20-\x7e]+$/);
    }
  });

  test("labels and glyphs are distinguishable", () => {
    expect(new Set(statuses.map((s) => s.label)).size).toBe(statuses.length);
    expect(new Set(statuses.map((s) => s.glyphs.unicode)).size).toBe(statuses.length);
    expect(new Set(statuses.map((s) => s.glyphs.ascii)).size).toBe(statuses.length);
  });

  test("glyph selection follows the icon set", () => {
    expect(statusGlyph("success", "unicode")).toBe("✓");
    expect(statusGlyph("failed", "ascii")).toBe("[x]");
    // Nerd Font glyphs are opt-in; until mapped, they fall back to the unicode set.
    expect(statusGlyph("running", "nerd")).toBe(statusGlyph("running", "unicode"));
  });
});
