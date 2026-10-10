import { afterEach, describe, expect, test } from "bun:test";
import type { TestRendererSetup } from "@opentui/core/testing";
import { testRender } from "@opentui/solid";
import { Suspense } from "solid-js";
import { CommandBus } from "../../../../src/application/commands/command-bus";
import type { ProcessRunner, ProcessSpec } from "../../../../src/application/ports/process-runner";
import { registerPluginActions } from "../../../../src/bootstrap/plugins";
import type { WorkspaceId } from "../../../../src/domain/shared/ids";
import type { AbsolutePath } from "../../../../src/domain/shared/path";
import { ok } from "../../../../src/domain/shared/result";
import type { Timestamp } from "../../../../src/domain/shared/time";
import type { Workspace, WorkspaceName } from "../../../../src/domain/workspace/workspace";
import { gitPlugin } from "../../../../src/plugins/git/plugin";
import type { PluginParts } from "../../../../src/plugins/plugin";
import { fakeSecrets } from "../../../support/fake-secrets";
import { ManualClock } from "../../../support/manual-clock";
import { fakeCore } from "../../../support/plugin-context";
import { SequentialIds } from "../../../support/sequential-ids";
import { testLogger } from "../../../support/test-logger";

const MOBILE: Workspace = {
  id: "mobile" as WorkspaceId,
  name: "Mobile" as WorkspaceName,
  path: "/work/mobile" as AbsolutePath,
  group: null,
  addedAt: 0 as Timestamp,
  lastActiveAt: null,
};

const HASH = "1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b";
/** Porcelain v2 status of a repository with one staged and one unstaged change. */
const CHANGED = [
  "# branch.oid 1a2b3c4d5e6f",
  "# branch.head main",
  `1 M. N... 100644 100644 100644 ${HASH} ${HASH} src/app.ts`,
  `1 .M N... 100644 100644 100644 ${HASH} ${HASH} README.md`,
  "",
].join("\0");

/** A runner standing in for git, in a repository or outside any, remembering what it ran. */
function fakeGitRunner(specs: ProcessSpec[], repository: boolean): ProcessRunner {
  const answer = (exitCode: number, stdout: string, stderr = "") =>
    Promise.resolve(ok({ exitCode, stdout, stderr, durationMs: 1, truncated: false }));
  return {
    run: (spec) => {
      specs.push(spec);
      switch (spec.args[0]) {
        case "status":
          return repository
            ? answer(0, CHANGED)
            : answer(128, "", "fatal: not a git repository (or any of the parent directories)\n");
        case "rev-parse":
          return answer(0, "5d1e0c4b3a29\n");
        default:
          return answer(0, "");
      }
    },
  };
}

function start(settings: unknown, specs: ProcessSpec[] = [], repository = false) {
  const logger = testLogger().logger;
  const clock = new ManualClock();
  const bus = new CommandBus({ logger, clock, ids: new SequentialIds() });
  const context = {
    bus,
    processes: fakeGitRunner(specs, repository),
    http: { request: () => Promise.reject(new Error("git makes no HTTP requests")) },
    secrets: fakeSecrets(),
    logger,
    clock,
    core: fakeCore().core,
  };
  const started = gitPlugin.start(context, settings, "config.yml");
  if (started.ok && started.value !== null) {
    registerPluginActions(bus, [{ plugin: gitPlugin, parts: started.value }]);
  }
  return started;
}

let setup: TestRendererSetup | undefined;
afterEach(() => {
  setup?.renderer.destroy();
  setup = undefined;
});

describe("gitPlugin", () => {
  test("starts with commands, actions and a section by default", () => {
    const started = start({});
    expect(started.ok && started.value?.commands !== undefined).toBe(true);
    expect(started.ok && started.value?.view !== undefined).toBe(true);
    expect(started.ok && started.value?.actions?.map((action) => action.name)).toEqual([
      "git.stage",
      "git.unstage",
      "git.commit",
      "git.branch.create",
      "git.branch.checkout",
      "git.branch.delete",
      "git.fetch",
      "git.pull",
      "git.push",
    ]);
  });

  test("turned off, it starts nothing", () => {
    expect(start({ enabled: false })).toEqual(ok(null));
  });

  test("a refresh outside one second to five minutes is refused", () => {
    const started = start({ refreshSeconds: 0 });
    expect(started.ok).toBe(false);
    if (!started.ok && started.error.kind === "configuration") {
      expect(started.error.issues.map((issue) => issue.path)).toEqual([
        "plugins.git.refreshSeconds",
      ]);
    }
  });

  /** Draws the plugin's own section, waiting out the dynamic import that brings its code. */
  async function section(specs: ProcessSpec[], repository: boolean, focused: boolean) {
    const started = start({}, specs, repository);
    const View = (started.ok ? started.value : null)?.view as NonNullable<PluginParts["view"]>;
    setup = await testRender(
      () => (
        <box width="100%" height="100%" flexDirection="column">
          <Suspense>
            <View
              workspace={MOBILE}
              width={60}
              rows={10}
              icons="unicode"
              focused={focused}
              setStatus={() => undefined}
              setKeys={() => undefined}
              setModal={() => undefined}
              report={() => undefined}
            />
          </Suspense>
        </box>
      ),
      { width: 64, height: 24 },
    );
    return setup;
  }

  /** The frame once it shows `text`; the section's code arrives in real time, not in frames. */
  async function showing(text: string) {
    for (let tries = 0; tries < 100; tries++) {
      await setup?.renderOnce();
      const frame = setup?.captureCharFrame() ?? "";
      if (frame.includes(text)) return frame;
      await Bun.sleep(10);
    }
    return setup?.captureCharFrame() ?? "";
  }

  test("its section loads when first drawn and reads the workspace's status", async () => {
    const specs: ProcessSpec[] = [];
    await section(specs, false, false);
    expect(await showing("not a git repository")).toContain("Mobile is not a git repository.");
    expect(specs[0]?.cwd).toBe(MOBILE.path);
  });

  test("its section stages, unstages and commits through the command bus", async () => {
    const specs: ProcessSpec[] = [];
    const view = await section(specs, true, true);
    await showing("Not staged (1)");
    view.mockInput.pressKey(" ");
    await Bun.sleep(10);
    view.mockInput.pressKey("a");
    await Bun.sleep(10);
    view.mockInput.pressKey("c");
    await showing(" Commit on main ");
    await view.mockInput.typeText("Fix login");
    view.mockInput.pressKey("s", { ctrl: true });
    expect(await showing("Committed")).toContain("✓ Committed 5d1e0c4 Fix login");
    expect(specs.map((spec) => spec.args).filter((args) => args[0] !== "status")).toEqual([
      ["reset", "--quiet", "--", ":(top,literal)src/app.ts"],
      ["add", "--all", "--", ":/"],
      ["commit", "--quiet", "--message=Fix login"],
      ["rev-parse", "--verify", "HEAD"],
    ]);
  });
});
