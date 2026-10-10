import type { AnyCommand } from "../../src/application/commands/command";
import { CommandBus } from "../../src/application/commands/command-bus";
import { registerPluginActions } from "../../src/bootstrap/plugins";
import { gitActions } from "../../src/plugins/git/application/actions";
import type { GitClient } from "../../src/plugins/git/application/git-client";
import { gitPlugin } from "../../src/plugins/git/plugin";
import type { GitSection } from "../../src/plugins/git/tui/git-view";
import { ManualClock } from "./manual-clock";
import { SequentialIds } from "./sequential-ids";
import { testLogger } from "./test-logger";

/** What the Git section is given, with its commands on a real bus over `client`. */
export function gitSectionFor(client: GitClient, refreshMs = 30): GitSection {
  const bus = new CommandBus({
    logger: testLogger().logger,
    clock: new ManualClock(),
    ids: new SequentialIds(),
  });
  const actions = gitActions(client);
  registerPluginActions(bus, [
    { plugin: gitPlugin, parts: { actions: Object.values(actions) as AnyCommand[] } },
  ]);
  return {
    client,
    actions,
    invoke: (command, input, options) => bus.invoke(command, input, options),
    refreshMs,
    branchPrefix: "feature/",
  };
}
