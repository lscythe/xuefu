/**
 * Regenerates the golden TUI screenshots and renders them to PNG for review.
 *   bun scripts/screenshots.ts [--out dist/screenshots]
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { parseArgs } from "node:util";
import { Resvg } from "@resvg/resvg-js";

const { values } = parseArgs({
  args: Bun.argv.slice(2),
  strict: true,
  options: { out: { type: "string", default: "dist/screenshots" } },
});

const GOLDEN_DIR = "tests/unit/tui/__screenshots__";

const update = Bun.spawnSync([process.execPath, "test", "./tests/unit/tui/screenshots.test.tsx"], {
  env: { ...process.env, UPDATE_SCREENSHOTS: "1" },
  stdout: "inherit",
  stderr: "inherit",
});
if (update.exitCode !== 0) process.exit(update.exitCode ?? 1);

mkdirSync(values.out, { recursive: true });
for (const file of readdirSync(GOLDEN_DIR)
  .filter((f) => f.endsWith(".svg"))
  .sort()) {
  const svg = readFileSync(join(GOLDEN_DIR, file), "utf8");
  const png = new Resvg(svg, {
    font: { loadSystemFonts: true, defaultFontFamily: "Menlo" },
    fitTo: { mode: "zoom", value: 2 },
  })
    .render()
    .asPng();
  const target = join(values.out, `${basename(file, ".svg")}.png`);
  writeFileSync(target, png);
  console.log(`rendered ${target}`);
}
