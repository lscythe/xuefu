import { z } from "zod";
import { defineCommand } from "../../../application/commands/command";
import { domainString } from "../../../application/validation";
import { absolutePath } from "../../../domain/shared/path";
import { ok } from "../../../domain/shared/result";
import { commitMessage, commitSubject, repositoryPath } from "../domain/commit";
import type { GitClient } from "./git-client";

/** More than any status XueFu would list. */
const MAX_FILES = 100_000;

const files = z.union([
  z.literal("all"),
  z.array(domainString(repositoryPath)).min(1).max(MAX_FILES),
]);

/** A commit just made. */
export interface Committed {
  readonly commit: string;
  readonly subject: string;
}

/** What the git plugin can do to a repository, as commands on the bus. */
export function gitActions(client: GitClient) {
  const stage = defineCommand({
    name: "git.stage",
    title: "Stage changes",
    category: "Git",
    safety: "safe",
    input: z.strictObject({ folder: domainString(absolutePath), files }),
    handler: (input, context) => client.stage(input.folder, input.files, context.signal),
  });

  const unstage = defineCommand({
    name: "git.unstage",
    title: "Unstage changes",
    category: "Git",
    safety: "safe",
    input: z.strictObject({ folder: domainString(absolutePath), files }),
    handler: (input, context) => client.unstage(input.folder, input.files, context.signal),
  });

  const commit = defineCommand({
    name: "git.commit",
    title: "Commit staged changes",
    category: "Git",
    safety: "safe",
    input: z.strictObject({
      folder: domainString(absolutePath),
      message: domainString(commitMessage),
    }),
    handler: async (input, context) => {
      const made = await client.commit(input.folder, input.message, context.signal);
      if (!made.ok) return made;
      return ok<Committed>({ commit: made.value, subject: commitSubject(input.message) });
    },
  });

  return { stage, unstage, commit } as const;
}
