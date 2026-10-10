import { afterEach, describe, expect, test } from "bun:test";
import type { TestRendererSetup } from "@opentui/core/testing";
import { testRender } from "@opentui/solid";
import type { ConfirmationPrompt } from "../../../src/domain/shared/confirmation";
import { ConfirmDialog } from "../../../src/tui/confirm-dialog";

const PUSH: ConfirmationPrompt = {
  title: "Push",
  severity: "confirm",
  details: [
    { label: "Branch", value: "main" },
    { label: "To", value: "origin/main" },
  ],
  consequence: "Sends 2 commits to origin/main.",
  confirmLabel: "Push",
};

const DELETE: ConfirmationPrompt = {
  ...PUSH,
  title: "Delete branch",
  severity: "destructive",
  consequence: "Its unmerged commits are lost.",
  confirmLabel: "Delete",
};

let setup: TestRendererSetup | undefined;
afterEach(() => {
  setup?.renderer.destroy();
  setup = undefined;
});

async function ask(prompt: ConfirmationPrompt) {
  const answers: boolean[] = [];
  setup = await testRender(
    () => <ConfirmDialog prompt={prompt} icons="unicode" onAnswer={(yes) => answers.push(yes)} />,
    { width: 70, height: 16 },
  );
  await setup.renderOnce();
  return Object.assign(setup, { answers });
}

/** A lone ESC is only reported once the parser is sure no escape sequence follows. */
async function pressEsc(view: TestRendererSetup) {
  view.mockInput.pressEscape();
  await Bun.sleep(30);
}

describe("ConfirmDialog", () => {
  test("names what it acts on and what follows", async () => {
    const view = await ask(PUSH);
    const frame = view.captureCharFrame();
    expect(frame).toContain(" Push? ");
    expect(frame).toContain("Branch  main");
    expect(frame).toContain("To      origin/main");
    expect(frame).toContain("Sends 2 commits to origin/main.");
    expect(frame).toContain("enter push  esc cancel");
  });

  test.each([
    ["return", true],
    ["y", true],
    ["n", false],
  ])("%s answers %p, once", async (key, approved) => {
    const view = await ask(PUSH);
    view.mockInput.pressKey(key === "return" ? "RETURN" : key);
    view.mockInput.pressKey("y");
    await view.renderOnce();
    expect(view.answers).toEqual([approved]);
  });

  test("esc declines", async () => {
    const view = await ask(PUSH);
    await pressEsc(view);
    expect(view.answers).toEqual([false]);
  });

  test("a destructive action takes y alone, never a habitual enter", async () => {
    const view = await ask(DELETE);
    expect(view.captureCharFrame()).toContain("⚠ Its unmerged commits are lost.");
    expect(view.captureCharFrame()).toContain("y delete  esc cancel");
    view.mockInput.pressEnter();
    await view.renderOnce();
    expect(view.answers).toEqual([]);
    view.mockInput.pressKey("y");
    await view.renderOnce();
    expect(view.answers).toEqual([true]);
  });
});
