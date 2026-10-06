import { expect } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { CapturedFrame, RGBA } from "@opentui/core";

/**
 * Terminal frames as SVG: one cell per column, colours and bold/dim/underline from the frame,
 * every glyph placed on its own column so drift is impossible. Deterministic, so the files work
 * as golden screenshots, and GitHub renders them in pull-request diffs.
 */
const CELL_WIDTH = 9;
const CELL_HEIGHT = 18;
const FONT_SIZE = 15;
const BASELINE = 14;
const FONT_FAMILY =
  "Menlo, 'DejaVu Sans Mono', 'Hiragino Sans GB', 'Noto Sans CJK SC', 'PingFang SC', monospace";

const BOLD = 1 << 0;
const DIM = 1 << 1;
const UNDERLINE = 1 << 3;

const SCREENSHOT_DIR = join(import.meta.dir, "..", "unit", "tui", "__screenshots__");

function hex(color: RGBA): string {
  const [r, g, b] = color.toInts();
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

function escapeXml(text: string): string {
  return text.replace(
    /[&<>"]/g,
    (c) => `&${{ "&": "amp", "<": "lt", ">": "gt", '"': "quot" }[c]};`,
  );
}

function frameToSvg(frame: CapturedFrame, title: string): string {
  const width = frame.cols * CELL_WIDTH;
  const height = frame.rows * CELL_HEIGHT;
  const out: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="${FONT_FAMILY}" font-size="${FONT_SIZE}">`,
    `<title>${escapeXml(title)}</title>`,
  ];
  frame.lines.forEach((line, row) => {
    const y = row * CELL_HEIGHT;
    let column = 0;
    for (const span of line.spans) {
      const x = column * CELL_WIDTH;
      out.push(
        `<rect x="${x}" y="${y}" width="${span.width * CELL_WIDTH}" height="${CELL_HEIGHT}" fill="${hex(span.bg)}"/>`,
      );
      const xs: number[] = [];
      let glyphs = "";
      let at = column;
      for (const char of span.text) {
        if (char !== " ") {
          xs.push(at * CELL_WIDTH);
          glyphs += char;
        }
        at += Math.max(1, Bun.stringWidth(char));
      }
      if (glyphs !== "") {
        const style = [
          span.attributes & BOLD ? ' font-weight="bold"' : "",
          span.attributes & DIM ? ' opacity="0.6"' : "",
          span.attributes & UNDERLINE ? ' text-decoration="underline"' : "",
        ].join("");
        out.push(
          `<text x="${xs.join(" ")}" y="${y + BASELINE}" fill="${hex(span.fg)}"${style}>${escapeXml(glyphs)}</text>`,
        );
      }
      column += span.width;
    }
  });
  out.push("</svg>", "");
  return out.join("\n");
}

/**
 * Compares a frame with its golden SVG. `UPDATE_SCREENSHOTS=1` rewrites goldens; a missing golden
 * is written locally but fails in CI, so a new screen cannot pass unreviewed.
 */
export function expectScreenshot(name: string, frame: CapturedFrame): void {
  const file = join(SCREENSHOT_DIR, `${name}.svg`);
  const svg = frameToSvg(frame, `XueFu: ${name}`);
  const update = process.env["UPDATE_SCREENSHOTS"] === "1";
  if (update || !existsSync(file)) {
    if (!update && process.env["CI"] === "true") {
      throw new Error(`Missing screenshot ${name}.svg; run bun run screenshots and commit it`);
    }
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, svg);
    return;
  }
  expect(svg).toBe(readFileSync(file, "utf8"));
}
