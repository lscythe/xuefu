import type { PluginCommandRunner, PluginCommandSpec } from "../../../cli/plugin-command";
import { ok } from "../../../domain/shared/result";
import type { GitClient } from "../application/git-client";
import {
  type ChangedFile,
  changeLetter,
  type GitStatus,
  isClean,
  stagedFiles,
  unstagedFiles,
} from "../domain/status";

export const GIT_COMMANDS: readonly PluginCommandSpec[] = [
  {
    group: "git",
    name: "status",
    isDefault: true,
    usage: "",
    minArgs: 0,
    maxArgs: 0,
    flags: {
      workspace: {
        type: "string",
        short: "w",
        value: "<id>",
        description: "another workspace than this folder's",
      },
      json: { type: "boolean", description: "machine-readable output" },
    },
    summary: "Show the branch and changed files of this workspace",
  },
];

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/** Where the branch stands: its name or detached commit, and how it compares with upstream. */
function describeBranch(status: GitStatus): string {
  if (status.branch === null) {
    return `HEAD detached at ${status.commit?.slice(0, 7) ?? "an unborn commit"}`;
  }
  const on = `On ${status.branch}`;
  if (status.commit === null) return `${on}, no commits yet`;
  if (status.upstream === null) return `${on}, not tracking a remote branch`;
  const { ahead, behind, upstream } = status;
  if (ahead > 0 && behind > 0) {
    return `${on}, diverged from ${upstream}: ${ahead} ahead, ${behind} behind`;
  }
  if (ahead > 0) return `${on}, ${plural(ahead, "commit", "commits")} ahead of ${upstream}`;
  if (behind > 0) return `${on}, ${plural(behind, "commit", "commits")} behind ${upstream}`;
  return `${on}, up to date with ${upstream}`;
}

const fileLine = (letter: string, file: { path: string; from?: string | null }) =>
  `  ${letter}  ${file.path}${file.from ? ` (from ${file.from})` : ""}`;

function section(title: string, lines: readonly string[]): string[] {
  return lines.length === 0 ? [] : [`${title}:`, ...lines];
}

function formatStatus(status: GitStatus): string {
  const lines = [
    describeBranch(status),
    ...section(
      "Conflicts",
      status.conflicts.map((path) => fileLine("U", { path })),
    ),
    ...section(
      "Staged",
      stagedFiles(status).map((file) => fileLine(changeLetter(file.staged), file)),
    ),
    ...section(
      "Not staged",
      unstagedFiles(status).map((file) => fileLine(changeLetter(file.unstaged), file)),
    ),
    ...section(
      "Untracked",
      status.untracked.map((path) => fileLine("?", { path })),
    ),
    ...(isClean(status) ? ["Nothing to commit, working tree clean."] : []),
    ...(status.stashes > 0 ? [plural(status.stashes, "stash", "stashes")] : []),
  ];
  return `${lines.join("\n")}\n`;
}

const fileJson = (file: ChangedFile, side: "staged" | "unstaged") => ({
  path: file.path,
  from: file.from,
  change: file[side],
});

function statusJson(workspace: string, status: GitStatus | null) {
  if (status === null) return { workspace, repository: false };
  return {
    workspace,
    repository: true,
    branch: status.branch,
    commit: status.commit,
    upstream: status.upstream,
    ahead: status.ahead,
    behind: status.behind,
    staged: stagedFiles(status).map((file) => fileJson(file, "staged")),
    unstaged: unstagedFiles(status).map((file) => fileJson(file, "unstaged")),
    conflicts: status.conflicts,
    untracked: status.untracked,
    stashes: status.stashes,
  };
}

/** Runs `xuefu git status`; exits 1 when the workspace is not a git repository. */
export function gitCommands(client: GitClient): PluginCommandRunner {
  return async (invocation, io) => {
    const id = invocation.flags["workspace"];
    const workspace = await io.workspace(typeof id === "string" ? id : null);
    if (!workspace.ok) return workspace;
    const { name, path } = workspace.value;
    const status = await client.status(path);
    if (!status.ok) return status;
    if (invocation.flags["json"] === true) {
      io.stdout(`${JSON.stringify(statusJson(workspace.value.id, status.value), null, 2)}\n`);
    } else if (status.value === null) {
      io.stderr(`${name} is not a git repository: ${path}\n`);
    } else {
      io.stdout(formatStatus(status.value));
    }
    return ok(status.value === null ? 1 : 0);
  };
}
