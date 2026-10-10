import { z } from "zod";
import { defineCommand } from "../../../application/commands/command";
import { domainString } from "../../../application/validation";
import { conflict } from "../../../domain/shared/errors";
import type { AbsolutePath } from "../../../domain/shared/path";
import { absolutePath } from "../../../domain/shared/path";
import { err, ok } from "../../../domain/shared/result";
import { branchName } from "../domain/branches";
import { commitMessage, commitSubject, repositoryPath } from "../domain/commit";
import type { GitClient } from "./git-client";

/** A remote's name: no option-like dash first, no spaces. */
const remoteName = z
  .string()
  .regex(/^[A-Za-z0-9._][A-Za-z0-9._/-]*$/, "must be a remote's name, such as origin");

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

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

  /**
   * Fails when HEAD is no longer on `branch`: what was approved for one branch is never done to
   * another that was switched to meanwhile.
   */
  const stillOn = async (folder: AbsolutePath, branch: string, signal: AbortSignal) => {
    const read = await client.status(folder, signal);
    if (!read.ok) return read;
    const now = read.value?.branch ?? null;
    return now === branch
      ? ok(undefined)
      : err(
          conflict(
            `The branch is now ${now ?? "a detached HEAD"}, not ${branch}`,
            "branch",
            branch,
            {
              hint: "Nothing was sent or brought in; try again on the branch in front.",
            },
          ),
        );
  };

  const fetch = defineCommand({
    name: "git.fetch",
    title: "Fetch",
    category: "Git",
    safety: "safe",
    input: z.strictObject({ folder: domainString(absolutePath) }),
    handler: (input, context) => client.fetch(input.folder, context.signal),
  });

  const pull = defineCommand({
    name: "git.pull",
    title: "Pull",
    category: "Git",
    safety: "confirm",
    input: z.strictObject({
      folder: domainString(absolutePath),
      branch: domainString(branchName),
      upstream: domainString(branchName),
      behind: z.int().min(0),
    }),
    describe: (input) => ({
      title: "Pull",
      severity: "confirm",
      details: [
        { label: "Branch", value: input.branch },
        { label: "From", value: input.upstream },
        { label: "Repository", value: input.folder },
      ],
      consequence: `Brings ${
        input.behind > 0 ? plural(input.behind, "commit", "commits") : "any new commits"
      } from ${input.upstream} into ${input.branch}, merging or rebasing as your git config says.`,
      confirmLabel: "Pull",
    }),
    handler: async (input, context) => {
      const on = await stillOn(input.folder, input.branch, context.signal);
      return on.ok ? client.pull(input.folder, context.signal) : on;
    },
  });

  const push = defineCommand({
    name: "git.push",
    title: "Push",
    category: "Git",
    safety: "confirm",
    input: z.strictObject({
      folder: domainString(absolutePath),
      branch: domainString(branchName),
      remote: remoteName,
      /** Null to publish the branch on `remote`, tracking it from then on. */
      upstream: domainString(branchName).nullable(),
      ahead: z.int().min(0),
    }),
    describe: (input) => {
      const to = input.upstream ?? `${input.remote}/${input.branch}`;
      return {
        title: input.upstream === null ? "Publish branch" : "Push",
        severity: "confirm",
        details: [
          { label: "Branch", value: input.branch },
          { label: "To", value: to },
          { label: "Repository", value: input.folder },
        ],
        consequence:
          input.upstream === null
            ? `Makes ${input.branch} on ${input.remote} with its commits, and tracks it from now on.`
            : `Sends ${plural(input.ahead, "commit", "commits")} to ${to}, where others will see them.`,
        confirmLabel: input.upstream === null ? "Publish" : "Push",
      };
    },
    handler: async (input, context) => {
      const on = await stillOn(input.folder, input.branch, context.signal);
      if (!on.ok) return on;
      const publish =
        input.upstream === null ? { remote: input.remote, branch: input.branch } : null;
      return client.push(input.folder, publish, context.signal);
    },
  });

  return {
    stage,
    unstage,
    commit,
    createBranch,
    checkout,
    deleteBranch,
    fetch,
    pull,
    push,
  } as const;
}

export type GitActions = ReturnType<typeof gitActions>;
