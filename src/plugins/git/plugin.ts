import { lazy } from "solid-js";
import { z } from "zod";
import { definePlugin } from "../plugin";
import { GIT_COMMANDS, gitCommands } from "./cli/commands";
import { cliGit } from "./integrations/cli-git";

const GitSettings = z.strictObject({
  enabled: z.boolean().default(true),
  /** How often the Git section reads status again while it is open. */
  refreshSeconds: z.int().min(1).max(300).default(3),
});

export const gitPlugin = definePlugin({
  id: "git",
  label: "Git",
  icons: { nerd: "\u{e725}", letter: "G" }, // dev-git_branch
  commands: GIT_COMMANDS,
  settings: GitSettings,
  start: (context, settings) => {
    const client = cliGit(context.processes);
    return {
      commands: gitCommands(client),
      view: lazy(async () => {
        const { gitView } = await import("./tui/git-view");
        return { default: gitView(client, settings.refreshSeconds * 1000) };
      }),
    };
  },
});
