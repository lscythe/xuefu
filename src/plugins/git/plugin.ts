import { z } from "zod";
import { definePlugin } from "../plugin";
import { GIT_COMMANDS, gitCommands } from "./cli/commands";
import { cliGit } from "./integrations/cli-git";

const GitSettings = z.strictObject({
  enabled: z.boolean().default(true),
});

export const gitPlugin = definePlugin({
  id: "git",
  label: "Git",
  icons: { nerd: "\u{e725}", letter: "G" }, // dev-git_branch
  commands: GIT_COMMANDS,
  settings: GitSettings,
  start: (context) => ({ commands: gitCommands(cliGit(context.processes)) }),
});
