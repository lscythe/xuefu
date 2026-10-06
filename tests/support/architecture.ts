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
  | "bootstrap";

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
    layers: ["domain", "application", "infrastructure", "integrations", "tui", "cli", "bootstrap"],
    packages: [ANY_PACKAGE],
  },
};

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

export function layerOf(file: string): Layer | null {
  if (file === "src/main.ts") return "bootstrap";
  const segment = file.split("/")[1];
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
    const layer = layerOf(from);
    if (layer === null) {
      violations.push({ from, target: from, reason: "file is not in a known layer" });
      continue;
    }
    const rule = RULES[layer];
    for (const dep of deps) {
      if (dep.kind === "internal") {
        const targetLayer = layerOf(dep.target);
        if (targetLayer !== null && !rule.layers.includes(targetLayer)) {
          violations.push({ from, target: dep.target, reason: `${layer} → ${targetLayer}` });
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
