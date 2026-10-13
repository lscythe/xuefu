import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AbsolutePath } from "../../../../src/domain/shared/path";
import { guidanceFiles } from "../../../../src/infrastructure/agent/guidance-files";
import { makeTempDir } from "../../../support/temp-dir";

let dir: ReturnType<typeof makeTempDir>;
beforeEach(() => {
  dir = makeTempDir();
});
afterEach(() => dir.cleanup());

test("each workspace has its own persona, reread after edits or removal", () => {
  const reader = guidanceFiles();
  const other = join(dir.path, "other");
  mkdirSync(other);
  const root = dir.path as AbsolutePath;
  const second = other as AbsolutePath;
  const file = join(root, "PERSONA.md");
  expect(reader.read(root, "PERSONA.md")).toEqual({ ok: true, value: null });
  writeFileSync(file, "  Indonesian comments.\n");
  writeFileSync(join(second, "PERSONA.md"), "English comments.");
  expect(reader.read(root, "PERSONA.md")).toEqual({ ok: true, value: "Indonesian comments." });
  expect(reader.read(second, "PERSONA.md")).toEqual({ ok: true, value: "English comments." });
  writeFileSync(file, "Formal comments.");
  expect(reader.read(root, "PERSONA.md")).toEqual({ ok: true, value: "Formal comments." });
  writeFileSync(file, "  \n");
  expect(reader.read(root, "PERSONA.md")).toEqual({ ok: true, value: null });
  unlinkSync(file);
  expect(reader.read(root, "PERSONA.md")).toEqual({ ok: true, value: null });
});

test("an unreadable persona is reported rather than treated as absent", () => {
  mkdirSync(join(dir.path, "PERSONA.md"));
  const result = guidanceFiles().read(dir.path as AbsolutePath, "PERSONA.md");
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.error.kind).toBe("filesystem");
});

test("project instructions are read separately from the persona", () => {
  const reader = guidanceFiles();
  const root = dir.path as AbsolutePath;
  expect(reader.read(root, "AGENTS.md")).toEqual({ ok: true, value: null });
  writeFileSync(join(root, "AGENTS.md"), "  Use TDD.\n");
  writeFileSync(join(root, "PERSONA.md"), "Indonesian comments.");
  expect(reader.read(root, "AGENTS.md")).toEqual({ ok: true, value: "Use TDD." });
  expect(reader.read(root, "PERSONA.md")).toEqual({ ok: true, value: "Indonesian comments." });
});
