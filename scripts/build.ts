/**
 * Compiles a standalone `xuefu` binary.
 *   bun scripts/build.ts [--target bun-darwin-arm64] [--outfile dist/xuefu]
 * Release builds run on native runners per platform (OpenTUI ships native libraries).
 */
import { parseArgs } from "node:util";
import solidPlugin from "@opentui/solid/bun-plugin";

const { values } = parseArgs({
  args: Bun.argv.slice(2),
  strict: true,
  options: {
    target: { type: "string" },
    outfile: { type: "string", default: "dist/xuefu" },
  },
});

const TARGETS = [
  "bun-linux-x64",
  "bun-linux-arm64",
  "bun-darwin-x64",
  "bun-darwin-arm64",
] as const satisfies readonly Bun.Build.CompileTarget[];
type Target = (typeof TARGETS)[number];

const isTarget = (value: string): value is Target => (TARGETS as readonly string[]).includes(value);

const outfile = values.outfile;
const target = values.target;
if (target !== undefined && !isTarget(target)) {
  console.error(`Unsupported target ${target}. Expected one of: ${TARGETS.join(", ")}`);
  process.exit(64);
}

const result = await Bun.build({
  entrypoints: ["src/main.ts"],
  minify: true,
  sourcemap: "linked",
  // Compiles the TUI's Solid JSX; the bunfig preload only covers `bun run` and `bun test`.
  plugins: [solidPlugin],
  compile: {
    outfile,
    ...(target === undefined ? {} : { target }),
  },
});

if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}
console.log(`built ${outfile}${target === undefined ? "" : ` (${target})`}`);
