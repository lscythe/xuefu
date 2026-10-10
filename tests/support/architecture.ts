/**
 * Static import analysis used to enforce the layer rules.
 *
 * Bun.Transpiler#scanImports drops type-only imports, but a type import from an outer layer is
 * still an architectural dependency, so imports are extracted from source text instead.
 */

export type Layer =
  | "domain"
  | "application"
  | "infrastructure"
  | "integrations"
  | "tui"
  | "cli"
  | "bootstrap"
  /** `src/plugins/*.ts`: the contract every plugin implements. */
  | "plugin-api"
  /** `src/plugins/<id>/*.ts`: one plugin's wiring of its own parts. */
  | "plugin";

/**
 * Where a file sits: its layer, and the plugin it belongs to. Inside `src/plugins/<id>/`, the
 * folders `domain`, `application`, `integrations`, `tui` and `cli` are those layers, scoped to
 * the plugin.
 */
export interface Location {
  readonly layer: Layer;
  /** Null for the core. */
  readonly plugin: string | null;
}

export type Dependency =
  | { readonly kind: "internal"; readonly target: string }
  | { readonly kind: "external"; readonly target: string };

/** file (repo-relative, posix) → its dependencies */
export type DependencyGraph = ReadonlyMap<string, readonly Dependency[]>;

export interface BoundaryViolation {
  readonly from: string;
  readonly target: string;
  readonly reason: string;
}

const ANY_PACKAGE = "*";

interface LayerRule {
  readonly layers: readonly Layer[];
  readonly packages: readonly string[];
}

const RULES: Readonly<Record<Layer, LayerRule>> = {
  domain: { layers: ["domain"], packages: [] },
  application: { layers: ["domain", "application"], packages: ["zod"] },
  infrastructure: {
    layers: ["domain", "application", "infrastructure"],
    packages: [ANY_PACKAGE],
  },
  integrations: {
    layers: ["domain", "application", "integrations"],
    packages: [ANY_PACKAGE],
  },
  tui: {
    layers: ["domain", "application", "tui"],
    packages: ["@opentui/core", "@opentui/solid", "solid-js"],
  },
  cli: { layers: ["domain", "application", "cli"], packages: ["node:util"] },
  bootstrap: {
    layers: [
      "domain",
      "application",
      "infrastructure",
      "integrations",
      "tui",
      "cli",
      "bootstrap",
      "plugin-api",
      "plugin",
    ],
    packages: [ANY_PACKAGE],
  },
  "plugin-api": {
    layers: ["domain", "application", "tui", "cli", "plugin-api"],
    packages: ["zod"],
  },
  plugin: {
    layers: ["domain", "application", "integrations", "tui", "cli", "plugin-api", "plugin"],
    packages: ["zod"],
  },
};

const PLUGIN_LAYERS: readonly Layer[] = ["domain", "application", "integrations", "tui", "cli"];

const IMPORT_PATTERNS: readonly RegExp[] = [
  // import x from "y" / import type { x } from "y" / export { x } from "y" (may span lines)
  /^\s*(?:import|export)\s[^;]*?\sfrom\s*["']([^"']+)["']/gm,
  // import "side-effect"
  /^\s*import\s*["']([^"']+)["']/gm,
  // await import("dynamic")
  /\bimport\(\s*["']([^"']+)["']\s*\)/g,
];

function stripLineComments(source: string): string {
  return source.replace(/^\s*\/\/.*$/gm, "");
}

export function extractImportSpecifiers(source: string): string[] {
  const code = stripLineComments(source);
  const found: { index: number; specifier: string }[] = [];
  for (const pattern of IMPORT_PATTERNS) {
    for (const match of code.matchAll(pattern)) {
      const specifier = match[1];
      if (specifier !== undefined) found.push({ index: match.index, specifier });
    }
  }
  found.sort((a, b) => a.index - b.index);
  return found.map((f) => f.specifier);
}

export function packageNameOf(specifier: string): string {
  if (specifier.startsWith("node:")) return specifier.split("/")[0] ?? specifier;
  const parts = specifier.split("/");
  if (specifier.startsWith("@")) return parts.slice(0, 2).join("/");
  return parts[0] ?? specifier;
}

export function locate(file: string): Location | null {
  if (file === "src/main.ts") return { layer: "bootstrap", plugin: null };
  const parts = file.split("/");
  if (parts[1] === "plugins") {
    if (parts.length === 3) return { layer: "plugin-api", plugin: null };
    const plugin = parts[2] ?? "";
    if (parts.length === 4) return { layer: "plugin", plugin };
    const layer = PLUGIN_LAYERS.find((candidate) => candidate === parts[3]);
    return layer === undefined ? null : { layer, plugin };
  }
  const layer = coreLayer(parts[1]);
  return layer === null ? null : { layer, plugin: null };
}

export function layerOf(file: string): Layer | null {
  return locate(file)?.layer ?? null;
}

function coreLayer(segment: string | undefined): Layer | null {
  switch (segment) {
    case "domain":
    case "application":
    case "infrastructure":
    case "integrations":
    case "tui":
    case "cli":
    case "bootstrap":
      return segment;
    default:
      return null;
  }
}

export function findBoundaryViolations(graph: DependencyGraph): BoundaryViolation[] {
  const violations: BoundaryViolation[] = [];
  for (const [from, deps] of graph) {
    const here = locate(from);
    if (here === null) {
      violations.push({ from, target: from, reason: "file is not in a known layer" });
      continue;
    }
    const { layer } = here;
    const rule = RULES[layer];
    for (const dep of deps) {
      if (dep.kind === "internal") {
        const there = locate(dep.target);
        if (there === null) continue;
        if (!rule.layers.includes(there.layer)) {
          violations.push({ from, target: dep.target, reason: `${layer} → ${there.layer}` });
        } else if (there.plugin !== null && there.plugin !== here.plugin && layer !== "bootstrap") {
          // Only bootstrap knows the plugins; the core and other plugins never reach into one.
          const who = here.plugin === null ? "core" : `plugin ${here.plugin}`;
          violations.push({ from, target: dep.target, reason: `${who} → plugin ${there.plugin}` });
        }
      } else {
        const pkg = packageNameOf(dep.target);
        if (!rule.packages.includes(ANY_PACKAGE) && !rule.packages.includes(pkg)) {
          violations.push({ from, target: dep.target, reason: `${layer} may not use ${pkg}` });
        }
      }
    }
  }
  return violations;
}

/** Tarjan's strongly connected components; returns components that form cycles. */
export function findCycles(edges: ReadonlyMap<string, readonly string[]>): string[][] {
  let index = 0;
  const indices = new Map<string, number>();
  const lowLinks = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const cycles: string[][] = [];

  const visit = (node: string): void => {
    indices.set(node, index);
    lowLinks.set(node, index);
    index += 1;
    stack.push(node);
    onStack.add(node);

    for (const next of edges.get(node) ?? []) {
      if (!indices.has(next)) {
        visit(next);
        lowLinks.set(node, Math.min(lowLinks.get(node) ?? 0, lowLinks.get(next) ?? 0));
      } else if (onStack.has(next)) {
        lowLinks.set(node, Math.min(lowLinks.get(node) ?? 0, indices.get(next) ?? 0));
      }
    }

    if (lowLinks.get(node) === indices.get(node)) {
      const component: string[] = [];
      let member: string | undefined;
      do {
        member = stack.pop();
        if (member === undefined) break;
        onStack.delete(member);
        component.push(member);
      } while (member !== node);
      const selfLoop = component.length === 1 && (edges.get(node) ?? []).includes(node);
      if (component.length > 1 || selfLoop) cycles.push(component);
    }
  };

  for (const node of edges.keys()) {
    if (!indices.has(node)) visit(node);
  }
  return cycles.sort((a, b) => [...a].sort()[0]?.localeCompare([...b].sort()[0] ?? "") ?? 0);
}
