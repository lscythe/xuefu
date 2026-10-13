import { afterEach, describe, expect, test } from "bun:test";
import type { TestRendererSetup } from "@opentui/core/testing";
import { testRender } from "@opentui/solid";
import { createSignal, Show } from "solid-js";
import type {
  AgentChoice,
  AgentChoosing,
  AgentModel,
} from "../../../../src/application/ports/agent";
import type { ProcessError } from "../../../../src/domain/shared/errors";
import { fileSystemError, processError } from "../../../../src/domain/shared/errors";
import { err, ok, type Result } from "../../../../src/domain/shared/result";
import { AgentPicker } from "../../../../src/tui/agent/agent-picker";

let setup: TestRendererSetup | undefined;
afterEach(() => {
  setup?.renderer.destroy();
  setup = undefined;
});

type Listed = Result<readonly AgentModel[], ProcessError>;

const CLAUDE_MODELS: Listed = ok([
  { id: null, name: "Claude Code's default" },
  { id: "opus", name: "Opus" },
  { id: "sonnet", name: "Sonnet" },
]);

/** Claude, whose models are known at once, and OpenCode, whose come when the test says. */
function fakeChoosing(current: AgentChoice, saves = true) {
  const chosen: AgentChoice[] = [];
  const { promise: openCodeModels, resolve: listOpenCode } = Promise.withResolvers<Listed>();
  let signal: AbortSignal | undefined;
  const choosing: AgentChoosing = {
    agents: () => [
      { id: "claude", name: "Claude" },
      { id: "opencode", name: "OpenCode" },
    ],
    models: (agent, given) => {
      signal = given;
      return agent === "claude" ? Promise.resolve(CLAUDE_MODELS) : openCodeModels;
    },
    current: () => current,
    choose: (choice) => {
      if (!saves)
        return err(fileSystemError("Unable to keep the agent chosen", "/a.json", "write"));
      chosen.push(choice);
      return ok(undefined);
    },
  };
  return { choosing, chosen, listOpenCode, signal: () => signal };
}

async function open(choosing: AgentChoosing, icons: "unicode" | "ascii" = "unicode") {
  const [shown, setShown] = createSignal(true);
  setup = await testRender(
    () => (
      <Show when={shown()}>
        <AgentPicker choosing={choosing} icons={icons} onClose={() => setShown(false)} />
      </Show>
    ),
    { width: 70, height: 20 },
  );
  const view = setup;
  const frame = async () => {
    await Bun.sleep(1);
    await view.renderOnce();
    return view.captureCharFrame();
  };
  return { view, frame, shown };
}

describe("AgentPicker", () => {
  test("every agent with its models as they are found, on the one in use", async () => {
    const fake = fakeChoosing({ agent: "claude", model: "opus" });
    const { frame } = await open(fake.choosing);
    let shown = await frame();
    expect(shown).toContain(" Agent and model ");
    expect(shown).toContain("Claude Code's default");
    expect(shown).toContain("▸ Opus  ● current");
    expect(shown).toContain("Finding its models…");
    expect(shown).toContain("3 of 3   ↑↓ move  enter choose  esc close");

    fake.listOpenCode(ok([{ id: "openai/gpt-5", name: "GPT-5" }]));
    shown = await frame();
    expect(shown).not.toContain("Finding its models…");
    expect(shown).toContain("GPT-5");
    // Still on the one in use, though more came.
    expect(shown).toContain("▸ Opus");
    expect(shown).toContain("4 of 4");
  });

  test("typing filters, arrows move, and Enter keeps the choice and closes", async () => {
    const fake = fakeChoosing({ agent: "claude", model: null });
    const { view, frame, shown } = await open(fake.choosing);
    fake.listOpenCode(
      ok([
        { id: "anthropic/claude-sonnet", name: "Claude Sonnet" },
        { id: "openai/gpt-5", name: "GPT-5" },
      ]),
    );
    await frame();
    view.mockInput.pressKey("s");
    view.mockInput.pressKey("o");
    view.mockInput.pressKey("n");
    let picked = await frame();
    expect(picked).toContain("> son");
    expect(picked).toContain("2 of 5");
    expect(picked).toContain("▸ Sonnet");
    view.mockInput.pressArrow("down");
    picked = await frame();
    expect(picked).toContain("▸ Claude Sonnet");
    view.mockInput.pressEnter();
    await frame();
    expect(fake.chosen).toEqual([{ agent: "opencode", model: "anthropic/claude-sonnet" }]);
    expect(shown()).toBe(false);
  });

  test("nothing matching says so; erasing brings them back", async () => {
    const fake = fakeChoosing({ agent: "claude", model: null });
    const { view, frame } = await open(fake.choosing);
    view.mockInput.pressKey("z");
    view.mockInput.pressKey("z");
    expect(await frame()).toContain("Finding its models…");
    fake.listOpenCode(ok([]));
    expect(await frame()).toContain('No model matches "zz"');
    view.mockInput.pressEnter();
    view.mockInput.pressArrow("down");
    expect(fake.chosen).toEqual([]);
    view.mockInput.pressBackspace();
    view.mockInput.pressBackspace();
    expect(await frame()).toContain("▸ Claude Code's default");
  });

  test("models that cannot be found, and a choice that cannot be kept, say why", async () => {
    const fake = fakeChoosing({ agent: "claude", model: null }, false);
    const { view, frame, shown } = await open(fake.choosing, "ascii");
    fake.listOpenCode(err(processError("OpenCode could not start: no provider", "opencode", null)));
    let picked = await frame();
    expect(picked).toContain("OpenCode could not start: no provider");
    expect(picked).toContain("> Claude Code's default  * current");
    expect(picked).toContain("up/down move");
    view.mockInput.pressEnter();
    picked = await frame();
    expect(picked).toContain("Unable to keep the agent chosen");
    expect(shown()).toBe(true);
  });

  test("Esc closes it, and stops finding models", async () => {
    const fake = fakeChoosing({ agent: "claude", model: null });
    const { view, frame, shown } = await open(fake.choosing);
    view.mockInput.pressEscape();
    await Bun.sleep(30);
    await frame();
    expect(shown()).toBe(false);
    expect(fake.signal()?.aborted).toBe(true);
    // What comes after it closed changes nothing.
    fake.listOpenCode(ok([{ id: "x", name: "X" }]));
    await Bun.sleep(1);
  });
});
