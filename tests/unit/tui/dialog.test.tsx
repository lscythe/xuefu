import { afterEach, describe, expect, test } from "bun:test";
import { RGBA } from "@opentui/core";
import type { TestRendererSetup } from "@opentui/core/testing";
import { testRender } from "@opentui/solid";
import { createSignal, Show } from "solid-js";
import { Dialog, outsideMask } from "../../../src/tui/dialog";
import { PALETTE } from "../../../src/tui/theme/palette";

let setup: TestRendererSetup | undefined;
afterEach(() => {
  setup?.renderer.destroy();
  setup = undefined;
});

/** The colour `text` is drawn in, as 0-255 red, green and blue. */
function colourOf(view: TestRendererSetup, text: string): number[] {
  const span = view
    .captureSpans()
    .lines.flatMap((line) => line.spans)
    .find((one) => one.text.includes(text));
  if (span === undefined) throw new Error(`${text} is not drawn`);
  return span.fg.toInts().slice(0, 3);
}

const MIST = RGBA.fromHex(PALETTE.text).toInts().slice(0, 3);

describe("outsideMask", () => {
  test("every cell but the box's, each at full strength", () => {
    const mask = outsideMask(3, 2, { x: 1, y: 0, width: 2, height: 1 });
    expect([...mask]).toEqual([0, 0, 1, 0, 1, 1, 1, 1, 1, 2, 1, 1]);
  });
});

describe("Dialog", () => {
  test("dims the cockpit behind it, not itself, and stops once closed", async () => {
    const [open, setOpen] = createSignal(true);
    setup = await testRender(
      () => (
        <box width="100%" height="100%">
          <text fg={PALETTE.text}>behind</text>
          <Show when={open()}>
            <Dialog title=" Front " width={30}>
              <text fg={PALETTE.text}>in front</text>
            </Dialog>
          </Show>
        </box>
      ),
      { width: 40, height: 12 },
    );
    await setup.renderOnce();
    expect(colourOf(setup, "in front")).toEqual(MIST);
    const dimmed = colourOf(setup, "behind");
    expect(dimmed.every((channel, i) => channel < (MIST[i] ?? 0) * 0.6)).toBe(true);

    setOpen(false);
    await setup.renderOnce();
    expect(colourOf(setup, "behind")).toEqual(MIST);
  });

  test("only the newest dialog stays bright; the one under it recedes too", async () => {
    setup = await testRender(
      () => (
        <box width="100%" height="100%">
          <Dialog title=" Under " width={36}>
            <text fg={PALETTE.text}>picker row</text>
            <text> </text>
            <text> </text>
            <text> </text>
            <text> </text>
          </Dialog>
          <Dialog title=" Over " width={20}>
            <text fg={PALETTE.text}>confirm</text>
          </Dialog>
        </box>
      ),
      { width: 40, height: 16 },
    );
    await setup.renderOnce();
    expect(colourOf(setup, "confirm")).toEqual(MIST);
    expect(colourOf(setup, "picker row")).not.toEqual(MIST);
  });
});
