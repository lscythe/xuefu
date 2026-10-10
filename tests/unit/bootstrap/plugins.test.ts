import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { defineCommand } from "../../../src/application/commands/command";
import { CommandBus } from "../../../src/application/commands/command-bus";
import { registerPluginActions, type StartedPlugin } from "../../../src/bootstrap/plugins";
import { ok } from "../../../src/domain/shared/result";
import { definePlugin } from "../../../src/plugins/plugin";
import { ManualClock } from "../../support/manual-clock";
import { SequentialIds } from "../../support/sequential-ids";
import { testLogger } from "../../support/test-logger";

const echo = (name: string) =>
  defineCommand({
    name,
    title: "Echo",
    category: "Test",
    safety: "safe",
    input: z.strictObject({ text: z.string() }),
    handler: (input) => Promise.resolve(ok(input.text)),
  });

const PLUGIN = definePlugin({
  id: "echo",
  label: "Echo",
  icons: { nerd: "e", letter: "E" },
  commands: [],
  settings: z.strictObject({ enabled: z.boolean().default(true) }),
  start: () => ({}),
});

const started = (...names: string[]): StartedPlugin[] => [
  { plugin: PLUGIN, parts: { actions: names.map(echo) } },
];

const newBus = () =>
  new CommandBus({
    logger: testLogger().logger,
    clock: new ManualClock(),
    ids: new SequentialIds(),
  });

describe("registerPluginActions", () => {
  test("puts each plugin's actions on the bus, where they run like any command", async () => {
    const bus = newBus();
    expect(registerPluginActions(bus, started("echo.say", "echo.shout"))).toEqual(ok(undefined));
    expect(bus.list().map((command) => command.name)).toEqual(["echo.say", "echo.shout"]);
    expect(await bus.dispatch("echo.say", { text: "hi" })).toEqual(ok("hi"));
  });

  test("an action named outside its plugin's id is refused", () => {
    const registered = registerPluginActions(newBus(), started("git.say"));
    expect(registered.ok).toBe(false);
    if (!registered.ok) {
      expect(registered.error.message).toBe("The Echo plugin's command git.say is misnamed");
    }
  });

  test("two actions with one name are refused", () => {
    const registered = registerPluginActions(newBus(), started("echo.say", "echo.say"));
    expect(registered.ok ? null : registered.error.kind).toBe("duplicate-command");
  });

  test("plugins with no actions add nothing", () => {
    const bus = newBus();
    expect(registerPluginActions(bus, [{ plugin: PLUGIN, parts: {} }])).toEqual(ok(undefined));
    expect(bus.list()).toEqual([]);
  });
});
