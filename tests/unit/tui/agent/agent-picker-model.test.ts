import { describe, expect, test } from "bun:test";
import { processError } from "../../../../src/domain/shared/errors";
import { err, ok } from "../../../../src/domain/shared/result";
import {
  type AgentModels,
  pickerRows,
  sameChoice,
} from "../../../../src/tui/agent/agent-picker-model";

const CLAUDE: AgentModels = {
  id: "claude",
  name: "Claude",
  models: ok([
    { id: null, name: "Claude Code's default" },
    { id: "opus", name: "Opus" },
    { id: "sonnet", name: "Sonnet" },
  ]),
};
const OPENCODE: AgentModels = {
  id: "opencode",
  name: "OpenCode",
  models: ok([
    { id: "anthropic/claude-sonnet", name: "Claude Sonnet" },
    { id: "openai/gpt-5", name: "GPT-5" },
  ]),
};

const shown = (rows: ReturnType<typeof pickerRows>) =>
  rows.map((row) =>
    row.kind === "model" ? `  ${row.name}` : row.kind === "agent" ? row.name : `  (${row.text})`,
  );

describe("pickerRows", () => {
  test("each agent under its name, its models in its order", () => {
    const rows = pickerRows([CLAUDE, OPENCODE], " ");
    expect(shown(rows)).toEqual([
      "Claude",
      "  Claude Code's default",
      "  Opus",
      "  Sonnet",
      "OpenCode",
      "  Claude Sonnet",
      "  GPT-5",
    ]);
    expect(rows[1]).toEqual({
      kind: "model",
      choice: { agent: "claude", model: null },
      name: "Claude Code's default",
      hits: [],
    });
  });

  test("typing keeps the models matching, by name or id, and the agents that have any", () => {
    expect(shown(pickerRows([CLAUDE, OPENCODE], "sonn"))).toEqual([
      "Claude",
      "  Sonnet",
      "OpenCode",
      "  Claude Sonnet",
    ]);
    const byId = pickerRows([CLAUDE, OPENCODE], "openai");
    expect(shown(byId)).toEqual(["OpenCode", "  GPT-5"]);
    // Matched on its id, so nothing in its name lights up.
    expect(byId[1]).toMatchObject({ hits: [] });
    expect(pickerRows([CLAUDE], "opus")[1]).toMatchObject({ hits: [0, 1, 2, 3] });
  });

  test("models still being found, or that could not be, say so whatever is typed", () => {
    const failed: AgentModels = {
      id: "opencode",
      name: "OpenCode",
      models: err(processError("OpenCode did not list its models in time", "opencode", null)),
    };
    expect(pickerRows([{ ...OPENCODE, models: null }, failed], "x")).toEqual([
      { kind: "agent", name: "OpenCode" },
      { kind: "note", text: "Finding its models…", failed: false },
      { kind: "agent", name: "OpenCode" },
      { kind: "note", text: "OpenCode did not list its models in time", failed: true },
    ]);
  });
});

describe("sameChoice", () => {
  test("the same agent on the same model", () => {
    expect(sameChoice({ agent: "claude", model: null }, { agent: "claude", model: null })).toBe(
      true,
    );
    expect(sameChoice({ agent: "claude", model: null }, { agent: "claude", model: "opus" })).toBe(
      false,
    );
    expect(sameChoice({ agent: "claude", model: null }, { agent: "opencode", model: null })).toBe(
      false,
    );
  });
});
