import { afterEach, describe, test } from "bun:test";
import type { TestRendererSetup } from "@opentui/core/testing";
import { testRender } from "@opentui/solid";
import { ok } from "../../../src/domain/shared/result";
import { Shell, type ShellProps } from "../../../src/tui/shell/shell";
import { ManualClock } from "../../support/manual-clock";
import { expectScreenshot } from "../../support/screenshot";
import { view } from "../../support/workspace-views";

/**
 * Golden screenshots of the cockpit. Review changes in the PR diff (GitHub renders SVG) or as PNGs
 * from `bun run screenshots`.
 */
const VIEWS = [
  view("mobile-banking", "Mobile Banking", "Banking Client"),
  view("shared-sdk", "Shared SDK", "Banking Client", "missing"),
  view("deployd", "deployd"),
  view("mobile-wallet", "Mobile Wallet"),
  view("auth-service", "Auth Service", "Platform"),
];
const [MOBILE] = VIEWS;

let setup: TestRendererSetup | undefined;
afterEach(() => {
  setup?.renderer.destroy();
  setup = undefined;
});

async function shell(props: Partial<ShellProps> = {}, size = { width: 100, height: 30 }) {
  setup = await testRender(
    () => (
      <Shell
        clock={new ManualClock(Date.UTC(2026, 9, 6, 13, 59, 41))}
        timeZone="UTC"
        icons="unicode"
        workspace={MOBILE?.workspace ?? null}
        loadWorkspaces={() => Promise.resolve(ok(VIEWS))}
        onQuit={() => undefined}
        {...props}
      />
    ),
    size,
  );
  await setup.renderOnce();
  return setup;
}

async function openSwitcher(screen: TestRendererSetup, query = "") {
  screen.mockInput.pressKey("w", { ctrl: true });
  await screen.waitForFrame((f) => f.includes("of 5"));
  if (query !== "") {
    await screen.mockInput.typeText(query);
    await screen.waitForFrame((f) => f.includes(`> ${query}`));
  }
}

describe("screenshots", () => {
  test("cockpit", async () => {
    expectScreenshot("cockpit", (await shell()).captureSpans());
  });

  test("cockpit, ascii icons, outside a workspace", async () => {
    const screen = await shell({ icons: "ascii", workspace: null });
    expectScreenshot("cockpit-ascii", screen.captureSpans());
  });

  test("terminal too small", async () => {
    const screen = await shell({}, { width: 70, height: 20 });
    expectScreenshot("too-small", screen.captureSpans());
  });

  test("switcher", async () => {
    const screen = await shell();
    await openSwitcher(screen);
    expectScreenshot("switcher", screen.captureSpans());
  });

  test("switcher, filtered", async () => {
    const screen = await shell();
    await openSwitcher(screen, "mob");
    expectScreenshot("switcher-filtered", screen.captureSpans());
  });
});
