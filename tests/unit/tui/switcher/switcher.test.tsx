import { afterEach, describe, expect, test } from "bun:test";
import { RGBA } from "@opentui/core";
import type { TestRendererSetup } from "@opentui/core/testing";
import { testRender } from "@opentui/solid";
import type { AppError } from "../../../../src/application/errors";
import type { WorkspaceView } from "../../../../src/application/workspace/queries";
import { storageError } from "../../../../src/domain/shared/errors";
import type { WorkspaceId } from "../../../../src/domain/shared/ids";
import { err, ok, type Result } from "../../../../src/domain/shared/result";
import type { Workspace } from "../../../../src/domain/workspace/workspace";
import { Switcher, type SwitcherProps } from "../../../../src/tui/switcher/switcher";
import { PALETTE } from "../../../../src/tui/theme/palette";
import { view } from "../../../support/workspace-views";

const VIEWS = [
  view("mobile-banking", "Mobile Banking", "Banking Client"),
  view("shared-sdk", "Shared SDK", "Banking Client", "missing"),
  view("deployd", "deployd"),
  view("mobile-wallet", "Mobile Wallet"),
  view("auth-service", "Auth Service"),
];

let setup: TestRendererSetup | undefined;
afterEach(() => {
  setup?.renderer.destroy();
  setup = undefined;
});

type Loaded = Result<readonly WorkspaceView[], AppError>;

async function renderSwitcher(props: Partial<SwitcherProps> = {}) {
  const chosen: Workspace[] = [];
  let closed = 0;
  setup = await testRender(
    () => (
      <box width="100%" height="100%">
        <Switcher
          load={() => Promise.resolve<Loaded>(ok(VIEWS))}
          currentId={null}
          icons="unicode"
          onChoose={(workspace) => {
            chosen.push(workspace);
            return Promise.resolve(ok(undefined));
          }}
          onClose={() => {
            closed += 1;
          }}
          {...props}
        />
      </box>
    ),
    { width: 100, height: 30 },
  );
  const screen = setup;
  await screen.waitForFrame((f) => !f.includes("Loading"));
  return Object.assign(screen, {
    chosen,
    closed: () => closed,
    type: async (text: string) => {
      await screen.mockInput.typeText(text);
      await screen.renderOnce();
    },
    frame: () => screen.captureCharFrame(),
  });
}

const line = (frame: string, text: string) =>
  frame.split("\n").find((row) => row.includes(text)) ?? "";

describe("Switcher", () => {
  test("lists workspaces by group and counts them", async () => {
    const frame = (await renderSwitcher()).frame();
    expect(frame).toContain("Switch workspace");
    expect(frame).toContain("Banking Client");
    expect(frame).toContain("Ungrouped");
    expect(line(frame, "Mobile Banking")).toContain("▸ Mobile Banking");
    expect(line(frame, "Mobile Banking")).toContain("mobile-banking");
    expect(frame).toContain("5 of 5");
  });

  test("shows a loading line until workspaces arrive", async () => {
    const { promise, resolve } = Promise.withResolvers<Loaded>();
    setup = await testRender(
      () => (
        <box width="100%" height="100%">
          <Switcher
            load={() => promise}
            currentId={null}
            icons="unicode"
            onChoose={() => Promise.resolve(ok(undefined))}
            onClose={() => undefined}
          />
        </box>
      ),
      { width: 100, height: 30 },
    );
    await setup.renderOnce();
    expect(setup.captureCharFrame()).toContain("Loading workspaces");
    resolve(ok(VIEWS));
    await setup.waitForFrame((f) => f.includes("Mobile Wallet"));
  });

  test("starts on the current workspace and tags it", async () => {
    const screen = await renderSwitcher({ currentId: "deployd" as WorkspaceId });
    expect(line(screen.frame(), "deployd ")).toContain("▸ deployd");
    expect(line(screen.frame(), "deployd ")).toContain("● current");
  });

  test("tags workspaces whose folder is gone", async () => {
    expect(line((await renderSwitcher()).frame(), "Shared SDK")).toContain("⚠ missing");
  });

  test("typing filters and ranks, highlighting matched letters", async () => {
    const screen = await renderSwitcher();
    await screen.type("mob");
    const frame = screen.frame();
    expect(frame).toContain("> mob");
    expect(frame).toContain("2 of 5");
    expect(frame).not.toContain("deployd");
    expect(frame).not.toContain("Banking Client");
    expect(line(frame, "Mobile Wallet")).toContain("▸ Mobile Wallet");

    const spans = screen.captureSpans().lines.flatMap((l) => l.spans);
    const hit = spans.find((s) => s.text === "Mob");
    expect(hit?.fg.equals(RGBA.fromHex(PALETTE.accentSpectral))).toBe(true);
  });

  test("letters type into the query instead of navigating or quitting", async () => {
    const screen = await renderSwitcher();
    await screen.type("jkq");
    expect(screen.frame()).toContain("> jkq");
    expect(screen.frame()).toContain('No workspace matches "jkq"');
    expect(screen.closed()).toBe(0);
  });

  test("arrows and ctrl+n/ctrl+p move and wrap; enter chooses", async () => {
    const screen = await renderSwitcher();
    screen.mockInput.pressArrow("down");
    screen.mockInput.pressKey("n", { ctrl: true });
    await screen.renderOnce();
    expect(line(screen.frame(), "deployd ")).toContain("▸ deployd");
    screen.mockInput.pressKey("p", { ctrl: true });
    screen.mockInput.pressArrow("up");
    screen.mockInput.pressArrow("up");
    await screen.renderOnce();
    expect(line(screen.frame(), "Auth Service")).toContain("▸ Auth Service");
    screen.mockInput.pressEnter();
    await screen.renderOnce();
    expect(screen.chosen.map((w) => w.id as string)).toEqual(["auth-service"]);
  });

  test("backspace, ctrl+w and ctrl+u edit the query", async () => {
    const screen = await renderSwitcher();
    await screen.type("mobile wal");
    screen.mockInput.pressBackspace();
    await screen.renderOnce();
    expect(screen.frame()).toContain("> mobile wa");
    screen.mockInput.pressKey("w", { ctrl: true });
    await screen.renderOnce();
    expect(screen.frame()).toContain("> mobile ");
    expect(screen.frame()).not.toContain("> mobile wa");
    screen.mockInput.pressKey("u", { ctrl: true });
    await screen.renderOnce();
    expect(screen.frame()).toContain("5 of 5");
  });

  test("pasted text joins the query on one line", async () => {
    const screen = await renderSwitcher();
    await screen.mockInput.pasteBracketedText("auth\nserv");
    await screen.renderOnce();
    expect(screen.frame()).toContain("> auth serv");
    expect(line(screen.frame(), "Auth Service")).toContain("▸ Auth Service");
  });

  test("escape closes; enter with nothing matching does nothing", async () => {
    const screen = await renderSwitcher();
    await screen.type("zzz");
    screen.mockInput.pressEnter();
    await screen.renderOnce();
    expect(screen.chosen).toEqual([]);
    screen.mockInput.pressEscape();
    // A lone ESC is only reported once the parser is sure no escape sequence follows.
    await Bun.sleep(30);
    expect(screen.closed()).toBe(1);
  });

  test("a failed switch shows why and keeps the switcher open", async () => {
    const refused = err(storageError("Unable to save workspaces", "workspaces.save"));
    const screen = await renderSwitcher({ onChoose: () => Promise.resolve(refused) });
    screen.mockInput.pressEnter();
    const frame = await screen.waitForFrame((f) => f.includes("Unable to save workspaces"));
    expect(line(frame, "Unable to save")).toContain("✗ Unable to save workspaces");
    expect(frame).toContain("Switch workspace");
    expect(screen.closed()).toBe(0);

    await screen.type("d");
    expect(screen.frame()).not.toContain("Unable to save workspaces");
  });

  test("enter is ignored while a switch is still in progress", async () => {
    let calls = 0;
    const { promise, resolve } = Promise.withResolvers<Result<unknown, AppError>>();
    const screen = await renderSwitcher({
      onChoose: () => {
        calls += 1;
        return promise;
      },
    });
    screen.mockInput.pressEnter();
    screen.mockInput.pressEnter();
    await screen.renderOnce();
    expect(calls).toBe(1);
    resolve(ok(undefined));
  });

  test("an empty registry explains how to add a workspace", async () => {
    const frame = (await renderSwitcher({ load: () => Promise.resolve<Loaded>(ok([])) })).frame();
    expect(frame).toContain("No workspaces yet");
    expect(frame).toContain("xuefu workspace add");
  });

  test("a failed load shows the error instead of a list", async () => {
    const failed = err(storageError("Unable to read workspaces", "workspaces.read"));
    const frame = (await renderSwitcher({ load: () => Promise.resolve<Loaded>(failed) })).frame();
    expect(frame).toContain("✗ Unable to read workspaces");
  });

  test("long lists scroll to keep the selection visible", async () => {
    const many = Array.from({ length: 30 }, (_, i) => view(`ws-${i}`, `Workspace ${i}`));
    const screen = await renderSwitcher({ load: () => Promise.resolve<Loaded>(ok(many)) });
    expect(screen.frame()).not.toContain("Workspace 29");
    screen.mockInput.pressArrow("up");
    await screen.renderOnce();
    expect(line(screen.frame(), "Workspace 29")).toContain("▸ Workspace 29");
    expect(screen.frame()).not.toContain("Workspace 0 ");
  });

  test("ascii icons use plain markers", async () => {
    const screen = await renderSwitcher({ icons: "ascii", currentId: "deployd" as WorkspaceId });
    expect(line(screen.frame(), "deployd ")).toContain("> deployd");
    expect(line(screen.frame(), "deployd ")).toContain("* current");
    expect(line(screen.frame(), "Shared SDK")).toContain("! missing");
  });
});
