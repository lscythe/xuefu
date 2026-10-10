import { z } from "zod";
import { defineCommand } from "../../../application/commands/command";
import { domainString } from "../../../application/validation";
import { absolutePath } from "../../../domain/shared/path";
import { ok } from "../../../domain/shared/result";
import { branchName } from "../domain/branches";
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

/** A branch delete's outcome: false when git kept it because its commits are not merged. */
export interface DeletedBranch {
  readonly deleted: boolean;
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

  const createBranch = defineCommand({
    name: "git.branch.create",
    title: "Create branch",
    category: "Git",
    safety: "safe",
    input: z.strictObject({
      folder: domainString(absolutePath),
      name: domainString(branchName),
      start: domainString(branchName).nullable(),
    }),
    handler: (input, context) =>
      client.createBranch(input.folder, input.name, input.start, context.signal),
  });

  const checkout = defineCommand({
    name: "git.branch.checkout",
    title: "Switch branch",
    category: "Git",
    safety: "safe",
    input: z.strictObject({
      folder: domainString(absolutePath),
      name: domainString(branchName),
      track: z.boolean(),
    }),
    handler: (input, context) =>
      client.switchBranch(input.folder, input.name, input.track, context.signal),
  });

  const deleteBranch = defineCommand({
    name: "git.branch.delete",
    title: "Delete branch",
    category: "Git",
    safety: "destructive",
    input: z.strictObject({
      folder: domainString(absolutePath),
      name: domainString(branchName),
      force: z.boolean(),
    }),
    describe: (input) => ({
      title: input.force ? "Force-delete branch" : "Delete branch",
      severity: input.force ? "destructive" : "confirm",
      details: [
        { label: "Branch", value: input.name },
        { label: "Repository", value: input.folder },
      ],
      consequence: input.force
        ? "Commits on it and on no other branch are lost, but for git's reflog."
        : "Git deletes it only once its commits are merged, so nothing is lost.",
      confirmLabel: "Delete",
    }),
    handler: async (input, context) => {
      const deleted = await client.deleteBranch(
        input.folder,
        input.name,
        input.force,
        context.signal,
      );
      return deleted.ok ? ok<DeletedBranch>({ deleted: deleted.value }) : deleted;
    },
  });

  return { stage, unstage, commit, createBranch, checkout, deleteBranch } as const;
}
