import { afterEach, describe, expect, test } from "bun:test";
import type { TestRendererSetup } from "@opentui/core/testing";
import { testRender } from "@opentui/solid";
import { createSignal, Show } from "solid-js";
import type { AgentHandlers, AgentHost } from "../../../../src/application/ports/agent";
import type { ConfirmationPrompt } from "../../../../src/domain/shared/confirmation";
import { processError } from "../../../../src/domain/shared/errors";
import type { AbsolutePath } from "../../../../src/domain/shared/path";
import { err, ok } from "../../../../src/domain/shared/result";
import { AgentDialog } from "../../../../src/tui/agent/agent-dialog";

let setup: TestRendererSetup | undefined;
afterEach(() => {
  setup?.renderer.destroy();
  setup = undefined;
});

const APPROVE: ConfirmationPrompt = {
  title: "Let Claude run pr approve",
  severity: "confirm",
  details: [{ label: "pullRequest", value: "MOB/app#42" }],
  consequence: "Approve a pull request, as you, as xuefu pr approve would, without asking again.",
  confirmLabel: "Allow",
};

/** An agent the test speaks for: what it is sent, whether it is stopped, and its handlers. */
function scriptedAgent(fails = false) {
  const sent: string[] = [];
  let stopped = 0;
  let handlers: AgentHandlers | null = null;
  const agent: AgentHost = {
    name: "Claude",
    ask: (question, given) => {
      if (fails) {
        return err(
          processError("Unable to run claude", "claude", null, { hint: "Install Claude Code" }),
        );
      }
      sent.push(question.prompt);
      handlers = given;
      return ok({
        send: (text) => sent.push(text),
        stop: () => {
          stopped += 1;
        },
      });
    },
  };
  return {
    agent,
    sent,
    stopped: () => stopped,
    handlers: () => handlers as AgentHandlers,
  };
}

async function open(agent: AgentHost, icons: "unicode" | "ascii" = "unicode", height = 24) {
  const [shown, setShown] = createSignal(true);
  setup = await testRender(
    () => (
      <Show when={shown()}>
        <AgentDialog
          agent={agent}
          title="Review MOB/app#42"
          cwd={"/w" as AbsolutePath}
          prompt="Review the pull request MOB/app#42."
          icons={icons}
          onClose={() => setShown(false)}
        />
      </Show>
    ),
    { width: 80, height },
  );
  await setup.renderOnce();
  const view = setup;
  const frame = async () => {
    await view.renderOnce();
    return view.captureCharFrame();
  };
  return { view, frame, shown, close: () => setShown(false) };
}

/** A lone ESC is only reported once the parser is sure no escape sequence follows. */
async function pressEsc(view: TestRendererSetup) {
  view.mockInput.pressEscape();
  await Bun.sleep(30);
}

describe("AgentDialog", () => {
  test("asks at once, then shows what the agent says and does as it happens", async () => {
    const script = scriptedAgent();
    const { frame } = await open(script.agent);
    expect(script.sent).toEqual(["Review the pull request MOB/app#42."]);
    let shown = await frame();
    expect(shown).toContain(" Claude · Review MOB/app#42 ");
    expect(shown).toContain("› Review the pull request MOB/app#42.");
    expect(shown).toContain("Claude is working…");

    const { onEvent } = script.handlers();
    onEvent({ kind: "ready", model: "claude-opus-5-5" });
    onEvent({ kind: "tool", name: "pr_diff", input: { pullRequest: "MOB/app#42" } });
    onEvent({ kind: "text", text: "Looks good, one risk in Login.kt line 11." });
    onEvent({ kind: "turn", costUsd: 0.0412, failed: null });
    shown = await frame();
    expect(shown).toContain("↳ pr diff MOB/app#42");
    expect(shown).toContain("Looks good, one risk in Login.kt line 11.");
    expect(shown).not.toContain("working");
    expect(shown).toContain("$0.04");
    expect(shown).toContain("Ask Claude more");
    expect(shown).toContain("enter send");
  });

  test("a follow-up is typed and sent with Enter, once the last answer is done", async () => {
    const script = scriptedAgent();
    const { view, frame } = await open(script.agent);
    // Still working: Enter waits, what is typed stays.
    await view.mockInput.typeText("Why?");
    view.mockInput.pressEnter();
    expect(script.sent).toHaveLength(1);
    expect(await frame()).toContain("Why?▏");

    script.handlers().onEvent({ kind: "turn", costUsd: null, failed: null });
    view.mockInput.pressBackspace();
    await view.mockInput.typeText(" exactly?");
    view.mockInput.pressEnter();
    expect(script.sent.at(-1)).toBe("Why exactly?");
    const shown = await frame();
    expect(shown).toContain("› Why exactly?");
    expect(shown).toContain("Claude is working…");

    // Ctrl+W and Ctrl+U erase; a blank message is not sent.
    script.handlers().onEvent({ kind: "turn", costUsd: null, failed: null });
    await view.mockInput.typeText("one two");
    view.mockInput.pressKey("w", { ctrl: true });
    expect(await frame()).toContain("one ▏");
    view.mockInput.pressKey("u", { ctrl: true });
    view.mockInput.pressEnter();
    expect(script.sent).toHaveLength(2);
  });

  test("what it wants to change is asked first; the answer goes back to it", async () => {
    const script = scriptedAgent();
    const { view, frame } = await open(script.agent);
    const answer = script.handlers().approve(APPROVE);
    const second = script.handlers().approve({ ...APPROVE, title: "Let Claude merge it" });
    let shown = await frame();
    expect(shown).toContain(" Let Claude run pr approve? ");
    expect(shown).toContain("pullRequest  MOB/app#42");
    expect(shown).toContain("enter allow");
    // Keys are the confirmation's: typing goes nowhere else.
    view.mockInput.pressKey("y");
    expect(await answer).toBe(true);
    shown = await frame();
    expect(shown).toContain(" Let Claude merge it? ");
    view.mockInput.pressKey("n");
    expect(await second).toBe(false);
    expect(await frame()).not.toContain("Let Claude");
  });

  test("Ctrl+C on a question declines it; the conversation stays", async () => {
    const script = scriptedAgent();
    const { view, shown } = await open(script.agent);
    const pending = script.handlers().approve(APPROVE);
    await view.renderOnce();
    view.mockInput.pressKey("c", { ctrl: true });
    expect(await pending).toBe(false);
    expect(shown()).toBe(true);
    expect(script.stopped()).toBe(0);
  });

  test("gone from the screen, it stops the agent and declines what it still waits on", async () => {
    const script = scriptedAgent();
    const { view, close } = await open(script.agent);
    const asked = script.handlers().approve(APPROVE);
    const queued = script.handlers().approve(APPROVE);
    await view.renderOnce();
    close();
    expect(await asked).toBe(false);
    expect(await queued).toBe(false);
    expect(script.stopped()).toBe(1);
  });

  test("Esc on a question declines just that; the next closes the conversation", async () => {
    const script = scriptedAgent();
    const { view, shown } = await open(script.agent);
    const pending = script.handlers().approve(APPROVE);
    await view.renderOnce();
    await pressEsc(view);
    expect(await pending).toBe(false);
    expect(shown()).toBe(true);
    await view.renderOnce();
    await pressEsc(view);
    expect(shown()).toBe(false);
  });

  test("Ctrl+C closes it too", async () => {
    const script = scriptedAgent();
    const { view, shown } = await open(script.agent);
    view.mockInput.pressKey("c", { ctrl: true });
    expect(shown()).toBe(false);
    expect(script.stopped()).toBe(1);
  });

  test("a long conversation scrolls, and keeps the newest in view until scrolled back", async () => {
    const script = scriptedAgent();
    const { view, frame } = await open(script.agent, "unicode", 20);
    const { onEvent } = script.handlers();
    for (let n = 1; n <= 30; n++) onEvent({ kind: "text", text: `Point ${n}.` });
    onEvent({ kind: "turn", costUsd: null, failed: null });
    let shown = await frame();
    expect(shown).toContain("Point 30.");
    expect(shown).not.toContain("Point 1.");

    view.mockInput.pressKey("\u001B[5~");
    shown = await frame();
    expect(shown).not.toContain("Point 30.");
    expect(shown).toMatch(/\d+\/\d+/);
    view.mockInput.pressArrow("up");
    view.mockInput.pressArrow("down");
    view.mockInput.pressKey("\u001B[6~");
    view.mockInput.pressKey("\u001B[6~");
    shown = await frame();
    expect(shown).toContain("Point 30.");
  });

  test("when it fails or stops, says why, and takes no more messages", async () => {
    const script = scriptedAgent();
    const { view, frame } = await open(script.agent, "ascii");
    const { onEvent } = script.handlers();
    onEvent({ kind: "turn", costUsd: null, failed: "Credit balance is too low" });
    onEvent({ kind: "exit", message: "Claude Code stopped (1)" });
    const shown = await frame();
    expect(shown).toContain("Credit balance is too low");
    expect(shown).toContain("Claude Code stopped (1)");
    expect(shown).toContain("Claude has stopped");
    expect(shown).toContain("pgup/pgdn scroll  esc close");
    expect(shown).not.toContain("enter send");
    await view.mockInput.typeText("more");
    view.mockInput.pressEnter();
    expect(script.sent).toHaveLength(1);
  });

  test("an agent that cannot start says so", async () => {
    const script = scriptedAgent(true);
    const { frame } = await open(script.agent);
    const shown = await frame();
    expect(shown).toContain("Unable to run claude");
    expect(shown).toContain("Claude has stopped");
  });

  test("a long message being typed shows its end", async () => {
    const script = scriptedAgent();
    const { view, frame } = await open(script.agent);
    script.handlers().onEvent({ kind: "turn", costUsd: null, failed: null });
    await view.mockInput.typeText(`${"a".repeat(100)}END`);
    const shown = await frame();
    expect(shown).toContain("END▏");
    expect(shown).not.toContain("a".repeat(80));
  });
});
