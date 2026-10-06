import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { dirname, join, normalize, relative } from "node:path";
import {
  type Dependency,
  type DependencyGraph,
  extractImportSpecifiers,
  findBoundaryViolations,
  findCycles,
} from "../support/architecture";

const ROOT = join(import.meta.dir, "..", "..");
const SOURCE_EXTENSIONS = [".ts", ".tsx"];

function resolveInternal(fromFile: string, specifier: string): string {
  const base = normalize(join(dirname(fromFile), specifier));
  const candidates = [base, ...SOURCE_EXTENSIONS.map((ext) => base + ext)];
  const hit = candidates.find((c) => existsSync(join(ROOT, c)) && /\.tsx?$/.test(c));
  return hit ?? base;
}

async function buildGraph(): Promise<DependencyGraph> {
  const graph = new Map<string, Dependency[]>();
  const glob = new Bun.Glob("src/**/*.{ts,tsx}");
  for await (const file of glob.scan({ cwd: ROOT })) {
    const posixFile = file.split("\\").join("/");
    const source = await Bun.file(join(ROOT, file)).text();
    const deps = extractImportSpecifiers(source).map((specifier): Dependency => {
      if (specifier.startsWith(".")) {
        const target = relative(ROOT, join(ROOT, resolveInternal(posixFile, specifier)));
        return { kind: "internal", target: target.split("\\").join("/") };
      }
      return { kind: "external", target: specifier };
    });
    graph.set(posixFile, deps);
  }
  return graph;
}

describe("architecture", async () => {
  const graph = await buildGraph();

  test("layer boundaries are respected", () => {
    expect(findBoundaryViolations(graph)).toEqual([]);
  });

  test("there are no import cycles in src/", () => {
    const edges = new Map(
      [...graph].map(([file, deps]) => [
        file,
        deps.filter((d) => d.kind === "internal").map((d) => d.target),
      ]),
    );
    expect(findCycles(edges)).toEqual([]);
  });

  test("relative imports resolve to existing files", () => {
    const missing = [...graph].flatMap(([file, deps]) =>
      deps
        .filter((d) => d.kind === "internal" && !existsSync(join(ROOT, d.target)))
        .map((d) => `${file} → ${d.target}`),
    );
    expect(missing).toEqual([]);
  });

  test("no source file spawns a shell", async () => {
    const offenders: string[] = [];
    for (const file of graph.keys()) {
      const source = await Bun.file(join(ROOT, file)).text();
      if (/["'](?:sh|bash|zsh)["']\s*,\s*["']-c["']/.test(source)) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });
});
