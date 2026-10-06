import { describe, expect, test } from "bun:test";
import {
  type DependencyGraph,
  extractImportSpecifiers,
  findBoundaryViolations,
  findCycles,
  layerOf,
  packageNameOf,
} from "../support/architecture";

describe("extractImportSpecifiers", () => {
  test("captures value, type-only, re-export, side-effect and dynamic imports", () => {
    const source = `
      import { a } from "./a";
      import type { B } from "./b";
      import { type C } from "./c";
      export type { D } from "./d";
      export { e } from "./e";
      import "./f";
      const g = await import("./g");
      import {
        h,
        i,
      } from "./h";
    `;
    expect(extractImportSpecifiers(source)).toEqual([
      "./a",
      "./b",
      "./c",
      "./d",
      "./e",
      "./f",
      "./g",
      "./h",
    ]);
  });

  test("ignores imports that only appear in line comments", () => {
    expect(
      extractImportSpecifiers(`// import { x } from "./x";\nimport { y } from "./y";`),
    ).toEqual(["./y"]);
  });
});

describe("packageNameOf", () => {
  test.each([
    ["zod", "zod"],
    ["zod/v4", "zod"],
    ["@opentui/solid", "@opentui/solid"],
    ["@opentui/core/testing", "@opentui/core"],
    ["node:fs/promises", "node:fs"],
    ["bun:sqlite", "bun:sqlite"],
  ])("%s → %s", (specifier, expected) => {
    expect(packageNameOf(specifier)).toBe(expected);
  });
});

describe("layerOf", () => {
  test.each([
    ["src/domain/shared/result.ts", "domain"],
    ["src/application/commands/command-bus.ts", "application"],
    ["src/infrastructure/config/paths.ts", "infrastructure"],
    ["src/integrations/jira/client.ts", "integrations"],
    ["src/tui/theme/palette.ts", "tui"],
    ["src/cli/parse-args.ts", "cli"],
    ["src/bootstrap/container.ts", "bootstrap"],
    ["src/main.ts", "bootstrap"],
  ] as const)("%s → %s", (file, layer) => {
    expect(layerOf(file)).toBe(layer);
  });

  test("files outside known layers are unclassified", () => {
    expect(layerOf("src/random/thing.ts")).toBeNull();
  });
});

describe("findBoundaryViolations", () => {
  const graph = (edges: Record<string, string[]>): DependencyGraph =>
    new Map(
      Object.entries(edges).map(([file, deps]) => [
        file,
        deps.map((d) =>
          d.startsWith("src/") ? { kind: "internal", target: d } : { kind: "external", target: d },
        ),
      ]),
    );

  test("allows inward dependencies", () => {
    const violations = findBoundaryViolations(
      graph({
        "src/application/a.ts": ["src/domain/x.ts", "zod"],
        "src/infrastructure/b.ts": ["src/application/a.ts", "src/domain/x.ts", "bun:sqlite"],
        "src/domain/x.ts": [],
      }),
    );
    expect(violations).toEqual([]);
  });

  test("rejects domain depending on any other layer or package", () => {
    const violations = findBoundaryViolations(
      graph({
        "src/domain/x.ts": ["src/application/a.ts", "zod", "node:path"],
        "src/application/a.ts": [],
      }),
    );
    expect(violations.map((v) => v.target)).toEqual(["src/application/a.ts", "zod", "node:path"]);
  });

  test("rejects application depending on infrastructure and unapproved packages", () => {
    const violations = findBoundaryViolations(
      graph({
        "src/application/a.ts": ["src/infrastructure/db.ts", "bun:sqlite"],
        "src/infrastructure/db.ts": [],
      }),
    );
    expect(violations.map((v) => v.target)).toEqual(["src/infrastructure/db.ts", "bun:sqlite"]);
  });

  test("rejects presentation depending on infrastructure or integrations", () => {
    const violations = findBoundaryViolations(
      graph({
        "src/tui/app.tsx": ["src/infrastructure/db.ts", "src/integrations/jira/c.ts"],
        "src/cli/run.ts": ["src/infrastructure/db.ts"],
        "src/infrastructure/db.ts": [],
        "src/integrations/jira/c.ts": [],
      }),
    );
    expect(violations).toHaveLength(3);
  });

  test("rejects integrations depending on infrastructure", () => {
    const violations = findBoundaryViolations(
      graph({
        "src/integrations/git/adapter.ts": ["src/infrastructure/process/runner.ts"],
        "src/infrastructure/process/runner.ts": [],
      }),
    );
    expect(violations).toHaveLength(1);
  });

  test("reports unclassified source files", () => {
    const violations = findBoundaryViolations(graph({ "src/misc/x.ts": [] }));
    expect(violations).toEqual([
      { from: "src/misc/x.ts", target: "src/misc/x.ts", reason: "file is not in a known layer" },
    ]);
  });

  test("bootstrap may depend on everything", () => {
    const violations = findBoundaryViolations(
      graph({
        "src/main.ts": ["src/infrastructure/db.ts", "src/tui/app.tsx", "src/cli/run.ts"],
        "src/infrastructure/db.ts": [],
        "src/tui/app.tsx": [],
        "src/cli/run.ts": [],
      }),
    );
    expect(violations).toEqual([]);
  });
});

describe("findCycles", () => {
  const edges = (e: Record<string, string[]>) =>
    new Map(Object.entries(e).map(([k, v]) => [k, v] as const));

  test("returns nothing for a DAG", () => {
    expect(findCycles(edges({ a: ["b"], b: ["c"], c: [] }))).toEqual([]);
  });

  test("detects a self loop and a multi-node cycle", () => {
    const cycles = findCycles(edges({ a: ["b"], b: ["c"], c: ["a"], d: ["d"], e: ["a"] }));
    expect(cycles.map((c) => [...c].sort())).toEqual([["a", "b", "c"], ["d"]]);
  });
});
