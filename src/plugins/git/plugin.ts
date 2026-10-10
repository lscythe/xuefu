import { lazy } from "solid-js";
import { z } from "zod";
import { definePlugin } from "../plugin";
import { gitActions } from "./application/actions";
import { GIT_COMMANDS, gitCommands } from "./cli/commands";
import { workBranch } from "./domain/branches";
import { cliGit } from "./integrations/cli-git";

const GitSettings = z.strictObject({
  enabled: z.boolean().default(true),
  /** How often the Git section reads status again while it is open. */
  refreshSeconds: z.int().min(1).max(300).default(3),
  /** Starts the branch the branch picker offers for the work in progress. */
  branchPrefix: z
    .string()
    .max(50)
    .refine(
      (prefix) => prefix === "" || workBranch(prefix, "X-1", null) !== null,
      "must start a name git takes, such as feature/",
    )
    .default("feature/"),
});

export const gitPlugin = definePlugin({
  id: "git",
  label: "Git",
  icons: { nerd: "\u{e725}", letter: "G" }, // dev-git_branch
  commands: GIT_COMMANDS,
  settings: GitSettings,
  start: (context, settings) => {
    const client = cliGit(context.processes);
    const actions = gitActions(client);
    return {
      commands: gitCommands(client),
      actions: [
        actions.stage,
        actions.unstage,
        actions.commit,
        actions.createBranch,
        actions.checkout,
        actions.deleteBranch,
        actions.fetch,
        actions.pull,
        actions.push,
      ],
      view: lazy(async () => {
        const { gitView } = await import("./tui/git-view");
        return {
          default: gitView({
            client,
            actions,
            invoke: (command, input, options) => context.bus.invoke(command, input, options),
            refreshMs: settings.refreshSeconds * 1000,
            branchPrefix: settings.branchPrefix,
          }),
        };
      }),
    };
  },
});
