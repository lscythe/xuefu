import { afterEach, describe, expect, test } from "bun:test";
import type { TestRendererSetup } from "@opentui/core/testing";
import { testRender } from "@opentui/solid";
import { Suspense } from "solid-js";
import type { ProcessRunner, ProcessSpec } from "../../../../src/application/ports/process-runner";
import type { WorkspaceId } from "../../../../src/domain/shared/ids";
import type { AbsolutePath } from "../../../../src/domain/shared/path";
import { ok } from "../../../../src/domain/shared/result";
import type { Timestamp } from "../../../../src/domain/shared/time";
import type { Workspace, WorkspaceName } from "../../../../src/domain/workspace/workspace";
import { gitPlugin } from "../../../../src/plugins/git/plugin";
import type { PluginParts } from "../../../../src/plugins/plugin";
import { ManualClock } from "../../../support/manual-clock";
import { testLogger } from "../../../support/test-logger";

const MOBILE: Workspace = {
  id: "mobile" as WorkspaceId,
  name: "Mobile" as WorkspaceName,
  path: "/work/mobile" as AbsolutePath,
  group: null,
  addedAt: 0 as Timestamp,
  lastActiveAt: null,
};

/** A runner where every folder is outside a repository. */
function notARepository(specs: ProcessSpec[]): ProcessRunner {
  return {
    run: (spec) => {
      specs.push(spec);
      return Promise.resolve(
        ok({
          exitCode: 128,
          stdout: "",
          stderr: "fatal: not a git repository (or any of the parent directories): .git\n",
          durationMs: 1,
          truncated: false,
        }),
      );
    },
  };
}

function start(settings: unknown, specs: ProcessSpec[] = []) {
  const context = {
    processes: notARepository(specs),
    logger: testLogger().logger,
    clock: new ManualClock(),
  };
  return gitPlugin.start(context, settings, "config.yml");
}

let setup: TestRendererSetup | undefined;
afterEach(() => {
  setup?.renderer.destroy();
  setup = undefined;
});

describe("gitPlugin", () => {
  test("starts with commands and a section by default", () => {
    const started = start({});
    expect(started.ok && started.value?.commands !== undefined).toBe(true);
    expect(started.ok && started.value?.view !== undefined).toBe(true);
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

  test("its section loads when first drawn and reads the workspace's status", async () => {
    const specs: ProcessSpec[] = [];
    const started = start({}, specs);
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
              setStatus={() => undefined}
            />
          </Suspense>
        </box>
      ),
      { width: 60, height: 12 },
    );
    const frame = async () => {
      // The section's code arrives by dynamic import, so give it real time, not just frames.
      for (let tries = 0; tries < 100; tries++) {
        await setup?.renderOnce();
        const text = setup?.captureCharFrame() ?? "";
        if (text.includes("not a git repository")) return text;
        await Bun.sleep(10);
      }
      return setup?.captureCharFrame() ?? "";
    };
    expect(await frame()).toContain("Mobile is not a git repository.");
    expect(specs[0]?.cwd).toBe(MOBILE.path);
  });
});
