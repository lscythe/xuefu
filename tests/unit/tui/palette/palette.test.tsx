import { afterEach, describe, expect, test } from "bun:test";
import type { TestRendererSetup } from "@opentui/core/testing";
import { testRender } from "@opentui/solid";
import { storageError } from "../../../../src/domain/shared/errors";
import { err, ok } from "../../../../src/domain/shared/result";
import { issueKey } from "../../../../src/domain/work/issue-key";
import { issueTitle } from "../../../../src/domain/work/work-context";
import { Palette, type PaletteProps } from "../../../../src/tui/palette/palette";
import type { PaletteEntry } from "../../../../src/tui/palette/palette-model";
import { dialogBounds } from "../../../support/dialog-bounds";

let setup: TestRendererSetup | undefined;
afterEach(() => {
  setup?.renderer.destroy();
  setup = undefined;
});

async function renderPalette(props: Partial<PaletteProps> = {}) {
  const ran: { title: string; values: readonly (string | null)[] }[] = [];
  let closed = 0;
  const entry = (title: string, keys: string | null, fields: PaletteEntry["fields"] = []) => ({
    title,
    keys,
    fields,
    run: (values: readonly (string | null)[]) => {
      ran.push({ title, values });
      return Promise.resolve(ok(undefined));
    },
  });
  const entries: PaletteEntry[] = [
    entry("Start work", null, [
      { label: "Issue key", example: "MOB-2841", optional: false, check: issueKey },
      { label: "Title", example: "Add biometric login", optional: true, check: issueTitle },
    ]),
    entry("Pause timer", "t"),
    entry("Switch workspace", "^W"),
    entry("Quit", "q"),
  ];
  setup = await testRender(
    () => (
      <box width="100%" height="100%">
        <Palette
          entries={entries}
          icons="unicode"
          onClose={() => {
            closed += 1;
          }}
          {...props}
        />
      </box>
    ),
    { width: 100, height: 30 },
  );
  await setup.renderOnce();
  return Object.assign(setup, { ran, closed: () => closed });
}

const rowWith = (frame: string, text: string) =>
  frame.split("\n").find((line) => line.includes(text)) ?? "";

describe("Palette", () => {
  test("lists what can be done, with each direct key beside it", async () => {
    const frame = (await renderPalette()).captureCharFrame();
    expect(frame).toContain(" Commands ");
    expect(rowWith(frame, "Start work…")).toContain("▸ Start work…");
    expect(rowWith(frame, "Pause timer")).toMatch(/Pause timer +t {2}│/);
    expect(frame).toContain("↑↓ move  enter run  esc close");
  });

  test("sits centred, keeps its size while filtering and fits the fields when asking", async () => {
    const palette = await renderPalette();
    const before = dialogBounds(palette.captureCharFrame(), " Commands ");
    expect(before.vertical).toBeLessThanOrEqual(1);
    expect(before.horizontal).toBeLessThanOrEqual(1);
    expect(before.bottom - before.top + 1).toBe(4 + 4);

    await palette.mockInput.typeText("quit");
    await palette.waitForFrame((f) => f.includes(": quit") && !f.includes("Pause timer"));
    expect(dialogBounds(palette.captureCharFrame(), " Commands ")).toEqual(before);

    await palette.mockInput.typeText("\b\b\b\b");
    palette.mockInput.pressEnter();
    await palette.waitForFrame((f) => f.includes(" Start work "));
    const asking = dialogBounds(palette.captureCharFrame(), " Start work ");
    expect(asking.vertical).toBeLessThanOrEqual(1);
    expect(asking.bottom - asking.top + 1).toBe(3 + 2);
  });

  test("typing filters; enter runs the entry and closes", async () => {
    const palette = await renderPalette();
    await palette.mockInput.typeText("pau");
    await palette.waitForFrame((f) => f.includes(": pau") && !f.includes("Quit"));
    palette.mockInput.pressEnter();
    await palette.waitForFrame(() => palette.closed() === 1);
    expect(palette.ran).toEqual([{ title: "Pause timer", values: [] }]);
  });

  test("arrows move the selection and wrap", async () => {
    const palette = await renderPalette();
    palette.mockInput.pressArrow("up");
    await palette.waitForFrame((f) => rowWith(f, "Quit").includes("▸"));
    palette.mockInput.pressArrow("down");
    await palette.waitForFrame((f) => rowWith(f, "Start work").includes("▸"));
  });

  test("an entry with fields asks for each, checking it, then runs", async () => {
    const palette = await renderPalette();
    palette.mockInput.pressEnter();
    let frame = await palette.waitForFrame((f) => f.includes("Issue key"));
    expect(frame).toContain(" Start work ");
    expect(frame).toContain("e.g. MOB-2841");
    expect(frame).toContain("enter next  esc back");

    palette.mockInput.pressEnter();
    await palette.waitForFrame((f) => f.includes("✗ Issue key is required: type one, e.g."));
    await palette.mockInput.typeText("nope");
    palette.mockInput.pressEnter();
    await palette.waitForFrame((f) => f.includes("✗ Issue key is invalid: must look like"));
    for (let i = 0; i < 4; i += 1) palette.mockInput.pressBackspace();
    await palette.mockInput.typeText("mob-1");
    palette.mockInput.pressEnter();

    frame = await palette.waitForFrame((f) => f.includes("Title (optional)"));
    expect(rowWith(frame, "Issue key")).toContain("Issue key  mob-1");
    palette.mockInput.pressEnter();
    await palette.waitForFrame(() => palette.closed() === 1);
    expect(palette.ran).toEqual([{ title: "Start work", values: ["mob-1", null] }]);
  });

  test("esc steps back from the fields to the list, then closes", async () => {
    const palette = await renderPalette();
    palette.mockInput.pressEnter();
    await palette.waitForFrame((f) => f.includes("Issue key"));
    palette.mockInput.pressEscape();
    await Bun.sleep(30);
    await palette.waitForFrame((f) => f.includes(" Commands "));
    expect(palette.closed()).toBe(0);
    palette.mockInput.pressEscape();
    await Bun.sleep(30);
    await palette.waitForFrame(() => palette.closed() === 1);
  });

  test("a failed run stays open and says why", async () => {
    const palette = await renderPalette({
      entries: [
        {
          title: "Stop timer",
          keys: "T",
          fields: [],
          run: () => Promise.resolve(err(storageError("Unable to save the timer", "timers.save"))),
        },
      ],
    });
    palette.mockInput.pressEnter();
    await palette.waitForFrame((f) => f.includes("✗ Unable to save the timer"));
    expect(palette.closed()).toBe(0);
    await palette.mockInput.typeText("x");
    await palette.waitForFrame((f) => !f.includes("Unable to save"));
  });

  test("no match says so; enter then does nothing", async () => {
    const palette = await renderPalette();
    await palette.mockInput.typeText("zzz");
    await palette.waitForFrame((f) => f.includes('No command matches "zzz"'));
    palette.mockInput.pressArrow("down");
    palette.mockInput.pressEnter();
    await palette.renderOnce();
    expect(palette.ran).toEqual([]);
  });

  test("paste types into the query or the field; ctrl+u and ctrl+w erase", async () => {
    const palette = await renderPalette({ icons: "ascii" });
    await palette.mockInput.pasteBracketedText("sw\nit");
    await palette.waitForFrame((f) => f.includes(": sw it_"));
    palette.mockInput.pressKey("w", { ctrl: true });
    await palette.waitForFrame((f) => f.includes(": sw _"));
    palette.mockInput.pressKey("u", { ctrl: true });
    await palette.waitForFrame((f) => f.includes(": _") && f.includes("up/down move"));
    palette.mockInput.pressEnter();
    await palette.waitForFrame((f) => f.includes("Issue key"));
    await palette.mockInput.pasteBracketedText("MOB-9");
    await palette.waitForFrame((f) => f.includes("> MOB-9_"));
  });
});
