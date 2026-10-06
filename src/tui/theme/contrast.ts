import type { HexColor } from "./palette";

function channel(value: number): number {
  const srgb = value / 255;
  return srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance(hex: HexColor): number {
  const rgb = Number.parseInt(hex.slice(1), 16);
  return (
    0.2126 * channel((rgb >> 16) & 0xff) +
    0.7152 * channel((rgb >> 8) & 0xff) +
    0.0722 * channel(rgb & 0xff)
  );
}

/** WCAG 2.x contrast ratio, from 1 (identical) to 21 (black on white). */
export function contrastRatio(a: HexColor, b: HexColor): number {
  const [lighter, darker] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x) as [
    number,
    number,
  ];
  return (lighter + 0.05) / (darker + 0.05);
}
