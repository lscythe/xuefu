import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { choiceFile } from "../../../../src/infrastructure/agent/choice-file";
import { makeTempDir } from "../../../support/temp-dir";

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

function folder(): string {
  const dir = makeTempDir("xuefu-choice-");
  cleanups.push(dir.cleanup);
  return dir.path;
}

describe("choiceFile", () => {
  test("nothing chosen yet is no choice; one kept is read back, in a folder made for it", () => {
    const path = join(folder(), "data", "agent.json");
    const choices = choiceFile(path);
    expect(choices.load()).toBeNull();
    expect(choices.save({ agent: "opencode", model: "openai/gpt-5" }).ok).toBe(true);
    expect(choices.load()).toEqual({ agent: "opencode", model: "openai/gpt-5" });
    expect(choices.save({ agent: "claude", model: null }).ok).toBe(true);
    expect(choiceFile(path).load()).toEqual({ agent: "claude", model: null });
    expect(readFileSync(path, "utf8")).toBe('{"agent":"claude","model":null}\n');
    expect(statSync(path).mode & 0o777).toBe(0o600);
  });

  test("a file that makes no sense is no choice", () => {
    const path = join(folder(), "agent.json");
    for (const text of ["{oops", "[]", '{"agent":1,"model":null}', '{"agent":"claude"}']) {
      writeFileSync(path, text);
      expect(choiceFile(path).load()).toBeNull();
    }
  });

  test("one that cannot be kept says where", () => {
    const path = join(folder(), "agent.json");
    mkdirSync(path);
    const saved = choiceFile(path).save({ agent: "claude", model: null });
    expect(!saved.ok && saved.error.message).toBe("Unable to keep the agent chosen");
  });
});
