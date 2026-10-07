import { afterEach, describe, test } from "bun:test";
import type { TestRendererSetup } from "@opentui/core/testing";
import { testRender } from "@opentui/solid";
import { storageError } from "../../../src/domain/shared/errors";
import { err, ok } from "../../../src/domain/shared/result";
import { Shell, type ShellProps } from "../../../src/tui/shell/shell";
import { fakeTabs } from "../../support/fake-tabs";
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

let setup: TestRendererSetup | undefined;
afterEach(() => {
  setup?.renderer.destroy();
  setup = undefined;
});

async function shell(props: Partial<ShellProps> = {}, size = { width: 100, height: 30 }) {
  const tabs = fakeTabs(VIEWS, "mobile-banking");
  setup = await testRender(
    () => (
      <Shell
        clock={new ManualClock(Date.UTC(2026, 9, 6, 13, 59, 41))}
        timeZone="UTC"
        icons="unicode"
        tabs={tabs.initial}
        loadWorkspaces={() => Promise.resolve(ok(VIEWS))}
        activateWorkspace={tabs.activate}
        closeTab={tabs.close}
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
    const screen = await shell({ icons: "ascii", tabs: fakeTabs(VIEWS).initial });
    expectScreenshot("cockpit-ascii", screen.captureSpans());
  });

  test("several tabs, the third in front", async () => {
    const tabs = fakeTabs(VIEWS, "mobile-banking", "deployd", "auth-service");
    const screen = await shell({
      tabs: tabs.initial,
      activateWorkspace: tabs.activate,
      closeTab: tabs.close,
    });
    expectScreenshot("tabs", screen.captureSpans());
  });

  test("tab change failed", async () => {
    const failed = err(storageError("Unable to save open tabs", "workspace_tabs.save"));
    const tabs = fakeTabs(VIEWS, "mobile-banking", "deployd");
    const screen = await shell({
      tabs: tabs.initial,
      closeTab: () => Promise.resolve(failed),
    });
    screen.mockInput.pressKey("w", { meta: true });
    await screen.waitForFrame((f) => f.includes("Unable to save open tabs"));
    expectScreenshot("tabs-error", screen.captureSpans());
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

  test("switcher, switch failed", async () => {
    const screen = await shell({
      activateWorkspace: () =>
        Promise.resolve(err(storageError("Unable to save workspaces", "workspaces.save"))),
    });
    await openSwitcher(screen, "auth");
    screen.mockInput.pressEnter();
    await screen.waitForFrame((f) => f.includes("Unable to save workspaces"));
    expectScreenshot("switcher-error", screen.captureSpans());
  });

  test("switcher, filtered", async () => {
    const screen = await shell();
    await openSwitcher(screen, "mob");
    expectScreenshot("switcher-filtered", screen.captureSpans());
  });
});
