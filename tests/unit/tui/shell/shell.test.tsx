import { afterEach, describe, expect, test } from "bun:test";
import { RGBA } from "@opentui/core";
import type { TestRendererSetup } from "@opentui/core/testing";
import { testRender } from "@opentui/solid";
import { storageError } from "../../../../src/domain/shared/errors";
import { err, ok } from "../../../../src/domain/shared/result";
import { Shell, type ShellProps } from "../../../../src/tui/shell/shell";
import { PALETTE } from "../../../../src/tui/theme/palette";
import { ManualClock } from "../../../support/manual-clock";
import { view } from "../../../support/workspace-views";

const MOBILE = view("mobile-banking", "Mobile Banking", "Banking Client");
const VIEWS = [MOBILE, view("deployd", "deployd"), view("auth-service", "Auth Service")];

let setup: TestRendererSetup | undefined;
afterEach(() => {
  setup?.renderer.destroy();
  setup = undefined;
});

async function renderShell(
  props: Partial<ShellProps> = {},
  size = { width: 100, height: 30 },
): Promise<TestRendererSetup & { quits: () => number }> {
  let quits = 0;
  setup = await testRender(
    () => (
      <Shell
        clock={new ManualClock(Date.UTC(2026, 9, 6, 13, 59, 41))}
        timeZone="UTC"
        icons="unicode"
        workspace={MOBILE.workspace}
        loadWorkspaces={() => Promise.resolve(ok(VIEWS))}
        activateWorkspace={(workspace) => Promise.resolve(ok(workspace))}
        onQuit={() => {
          quits += 1;
        }}
        {...props}
      />
    ),
    size,
  );
  await setup.renderOnce();
  return Object.assign(setup, { quits: () => quits });
}

function rowContaining(frame: string, text: string): string {
  return frame.split("\n").find((line) => line.includes(text)) ?? "";
}

describe("Shell", () => {
  test("shows the brand, workspace, clock, navigation, panel and key bar", async () => {
    const frame = (await renderShell()).captureCharFrame();
    const header = rowContaining(frame, "XUEFU");
    expect(header).toContain("血符 XUEFU");
    expect(header).toContain("Mobile Banking");
    expect(header).toContain("Tue 06 Oct • 13:59");
    for (const label of ["Dashboard", "Work", "Jira", "Git", "PRs", "Timesheet", "Notes"]) {
      expect(frame).toContain(label);
    }
    expect(frame).toContain("▍DASHBOARD");
    expect(rowContaining(frame, "navigate")).toContain("↑↓ navigate");
    expect(rowContaining(frame, "navigate")).toContain("^W workspaces");
    expect(rowContaining(frame, "navigate")).toContain("q quit");
  });

  test("says so when the current folder is not a workspace", async () => {
    const frame = (await renderShell({ workspace: null })).captureCharFrame();
    expect(rowContaining(frame, "XUEFU")).toContain("No workspace");
  });

  test("marks only the selected section", async () => {
    const frame = (await renderShell()).captureCharFrame();
    expect(rowContaining(frame, "Dashboard")).toContain("▌⌂ Dashboard");
    expect(rowContaining(frame, "Jira")).not.toContain("▌");
  });

  test("arrow keys and j/k move through sections and wrap at the ends", async () => {
    const shell = await renderShell();
    shell.mockInput.pressArrow("down");
    expect(await shell.waitForFrame((f) => f.includes("▍WORK"))).toContain("▌▤ Work");

    shell.mockInput.pressKey("k");
    await shell.waitForFrame((f) => f.includes("▍DASHBOARD"));

    shell.mockInput.pressArrow("up");
    expect(await shell.waitForFrame((f) => f.includes("▍NOTES"))).toContain("▌✎ Notes");

    shell.mockInput.pressKey("j");
    await shell.waitForFrame((f) => f.includes("▍DASHBOARD"));
  });

  test("home and end jump to the first and last section", async () => {
    const shell = await renderShell();
    shell.mockInput.pressKey("END");
    await shell.waitForFrame((f) => f.includes("▍NOTES"));
    shell.mockInput.pressKey("HOME");
    await shell.waitForFrame((f) => f.includes("▍DASHBOARD"));
  });

  test("q and ctrl+c ask to quit; other keys do not", async () => {
    const shell = await renderShell();
    shell.mockInput.pressKey("x");
    shell.mockInput.pressKey("q");
    shell.mockInput.pressCtrlC();
    await shell.renderOnce();
    expect(shell.quits()).toBe(2);
  });

  test("ctrl+w opens the switcher and choosing a workspace makes it current", async () => {
    const shell = await renderShell();
    shell.mockInput.pressKey("w", { ctrl: true });
    const open = await shell.waitForFrame((f) => f.includes("Switch workspace"));
    expect(rowContaining(open, "Mobile Banking  mobile-banking")).toContain("● current");

    await shell.mockInput.typeText("auth");
    shell.mockInput.pressEnter();
    const after = await shell.waitForFrame((f) => !f.includes("Switch workspace"));
    expect(rowContaining(after, "XUEFU")).toContain("Auth Service");

    shell.mockInput.pressKey("w", { ctrl: true });
    const reopened = await shell.waitForFrame((f) => f.includes("Switch workspace"));
    expect(rowContaining(reopened, "Auth Service  auth-service")).toContain("▸ Auth Service");
  });

  test("a switch that cannot be saved keeps the current workspace", async () => {
    const shell = await renderShell({
      activateWorkspace: () =>
        Promise.resolve(err(storageError("Unable to save workspaces", "workspaces.save"))),
    });
    shell.mockInput.pressKey("w", { ctrl: true });
    await shell.waitForFrame((f) => f.includes("Switch workspace"));
    await shell.mockInput.typeText("auth");
    shell.mockInput.pressEnter();
    const frame = await shell.waitForFrame((f) => f.includes("Unable to save workspaces"));
    expect(frame).toContain("Switch workspace");
    expect(rowContaining(frame, "XUEFU")).toContain("Mobile Banking");
  });

  test("while the switcher is open, letters go to the query, not the shell", async () => {
    const shell = await renderShell();
    shell.mockInput.pressKey("w", { ctrl: true });
    await shell.waitForFrame((f) => f.includes("Switch workspace"));
    await shell.mockInput.typeText("jq");
    const frame = await shell.waitForFrame((f) => f.includes("> jq"));
    expect(rowContaining(frame, "Dashboard")).toContain("▌⌂ Dashboard");
    expect(shell.quits()).toBe(0);

    shell.mockInput.pressEscape();
    await Bun.sleep(30);
    const closed = await shell.waitForFrame((f) => !f.includes("Switch workspace"));
    expect(rowContaining(closed, "XUEFU")).toContain("Mobile Banking");
    shell.mockInput.pressKey("j");
    await shell.waitForFrame((f) => f.includes("▍WORK"));
  });

  test("ctrl+c quits even with the switcher open", async () => {
    const shell = await renderShell();
    shell.mockInput.pressKey("w", { ctrl: true });
    await shell.waitForFrame((f) => f.includes("Switch workspace"));
    shell.mockInput.pressCtrlC();
    await shell.renderOnce();
    expect(shell.quits()).toBe(1);
  });

  test("the clock follows the injected time source", async () => {
    const clock = new ManualClock(Date.UTC(2026, 9, 6, 13, 59, 41));
    const shell = await renderShell({ clock, tickMs: 5 });
    clock.advance(60_000);
    await Bun.sleep(25);
    await shell.waitForFrame((f) => f.includes("Tue 06 Oct • 14:00"));
  });

  test("a terminal below 80×24 gets a notice instead of a broken layout", async () => {
    const shell = await renderShell({}, { width: 70, height: 20 });
    const frame = shell.captureCharFrame();
    expect(frame).toContain("Terminal too small");
    expect(frame).toContain("Need 80×24, have 70×20");
    expect(frame).not.toContain("Dashboard");

    shell.resize(80, 24);
    await shell.waitForFrame((f) => f.includes("Dashboard"));
  });

  test("ascii icons drop glyphs and arrows but keep every label", async () => {
    const frame = (await renderShell({ icons: "ascii" })).captureCharFrame();
    expect(rowContaining(frame, "Dashboard")).toContain("> Dashboard");
    expect(frame).not.toContain("⌂");
    expect(frame).not.toContain("▍");
    expect(frame).toContain("DASHBOARD");
    expect(rowContaining(frame, "navigate")).toContain("j/k navigate");
    expect(rowContaining(frame, "XUEFU")).toContain("Tue 06 Oct | 13:59");
  });

  test("uses the palette: vermilion brand mark and focus bar", async () => {
    const shell = await renderShell();
    const spans = shell.captureSpans().lines.flatMap((line) => line.spans);
    const brand = spans.find((span) => span.text.includes("血符"));
    const bar = spans.find((span) => span.text.startsWith("▌"));
    expect(brand?.fg.equals(RGBA.fromHex(PALETTE.accentPrimary))).toBe(true);
    expect(bar?.fg.equals(RGBA.fromHex(PALETTE.borderFocused))).toBe(true);
  });
});
