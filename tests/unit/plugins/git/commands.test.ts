import { describe, expect, test } from "bun:test";
import type { AppError } from "../../../../src/application/errors";
import type { PluginInvocation } from "../../../../src/cli/plugin-command";
import { notFound, processError } from "../../../../src/domain/shared/errors";
import type { WorkspaceId } from "../../../../src/domain/shared/ids";
import type { AbsolutePath } from "../../../../src/domain/shared/path";
import { err, ok, type Result } from "../../../../src/domain/shared/result";
import type { Timestamp } from "../../../../src/domain/shared/time";
import type { Workspace, WorkspaceName } from "../../../../src/domain/workspace/workspace";
import type { GitClient } from "../../../../src/plugins/git/application/git-client";
import { gitCommands } from "../../../../src/plugins/git/cli/commands";
import type { GitStatus } from "../../../../src/plugins/git/domain/status";

const MOBILE: Workspace = {
  id: "mobile" as WorkspaceId,
  name: "Mobile" as WorkspaceName,
  path: "/work/mobile" as AbsolutePath,
  group: null,
  addedAt: 0 as Timestamp,
  lastActiveAt: null,
};

const CLEAN: GitStatus = {
  branch: "main",
  commit: "1a2b3c4d5e6f",
  upstream: "origin/main",
  ahead: 0,
  behind: 0,
  changes: [],
  conflicts: [],
  untracked: [],
  stashes: 0,
};

const STATUS: Readonly<Record<string, string>> = {};

async function show(
  status: GitStatus | null,
  flags: PluginInvocation["flags"] = {},
  workspace: Result<Workspace, AppError> = ok(MOBILE),
) {
  const client: GitClient = { status: () => Promise.resolve(ok(status)) };
  let stdout = "";
  let stderr = "";
  const asked: (string | null)[] = [];
  const code = await gitCommands(client)(
    { group: "git", name: "status", args: [], flags: { ...STATUS, ...flags } },
    {
      workspace: (id) => {
        asked.push(id);
        return Promise.resolve(workspace);
      },
      stdout: (text) => {
        stdout += text;
      },
      stderr: (text) => {
        stderr += text;
      },
    },
  );
  return { code, stdout, stderr, asked };
}

describe("git status", () => {
  test.each([
    [CLEAN, "On main, up to date with origin/main"],
    [{ ...CLEAN, ahead: 2 }, "On main, 2 commits ahead of origin/main"],
    [{ ...CLEAN, behind: 1 }, "On main, 1 commit behind origin/main"],
    [{ ...CLEAN, ahead: 2, behind: 1 }, "On main, diverged from origin/main: 2 ahead, 1 behind"],
    [{ ...CLEAN, upstream: null }, "On main, not tracking a remote branch"],
    [{ ...CLEAN, commit: null, upstream: null }, "On main, no commits yet"],
    [{ ...CLEAN, branch: null }, "HEAD detached at 1a2b3c4"],
    [{ ...CLEAN, branch: null, commit: null }, "HEAD detached at an unborn commit"],
  ] as [GitStatus, string][])("describes where the branch stands: %#", async (status, line) => {
    const { stdout } = await show(status);
    expect(stdout.split("\n")[0]).toBe(line);
  });

  test("lists conflicts, staged, unstaged and untracked files, then stashes", async () => {
    const { code, stdout } = await show({
      ...CLEAN,
      changes: [
        { path: "src/app.ts", from: null, staged: "modified", unstaged: "deleted" },
        { path: "new.ts", from: "old.ts", staged: "renamed", unstaged: "unchanged" },
      ],
      conflicts: ["merge.ts"],
      untracked: ["notes.txt"],
      stashes: 2,
    });
    expect(code).toEqual(ok(0));
    expect(stdout).toBe(
      [
        "On main, up to date with origin/main",
        "Conflicts:",
        "  U  merge.ts",
        "Staged:",
        "  M  src/app.ts",
        "  R  new.ts (from old.ts)",
        "Not staged:",
        "  D  src/app.ts",
        "Untracked:",
        "  ?  notes.txt",
        "2 stashes",
        "",
      ].join("\n"),
    );
  });

  test("a clean tree says so; one stash is singular", async () => {
    const { stdout } = await show({ ...CLEAN, stashes: 1 });
    expect(stdout).toBe(
      "On main, up to date with origin/main\nNothing to commit, working tree clean.\n1 stash\n",
    );
  });

  test("--json lists each side's changes", async () => {
    const { stdout } = await show(
      {
        ...CLEAN,
        changes: [{ path: "a.ts", from: null, staged: "added", unstaged: "modified" }],
      },
      { json: true },
    );
    expect(JSON.parse(stdout)).toEqual({
      workspace: "mobile",
      repository: true,
      branch: "main",
      commit: "1a2b3c4d5e6f",
      upstream: "origin/main",
      ahead: 0,
      behind: 0,
      staged: [{ path: "a.ts", from: null, change: "added" }],
      unstaged: [{ path: "a.ts", from: null, change: "modified" }],
      conflicts: [],
      untracked: [],
      stashes: 0,
    });
  });

  test("passes --workspace on; a workspace that cannot be found is the error", async () => {
    const missing = notFound("workspace", "nope");
    const shown = await show(CLEAN, { workspace: "nope" }, err(missing));
    expect(shown.asked).toEqual(["nope"]);
    expect(shown.code).toEqual(err(missing));
  });

  test("a failing status is the error", async () => {
    const failure = processError("git status failed", "git", 128);
    const client: GitClient = { status: () => Promise.resolve(err(failure)) };
    const code = await gitCommands(client)(
      { group: "git", name: "status", args: [], flags: {} },
      {
        workspace: () => Promise.resolve(ok(MOBILE)),
        stdout: () => undefined,
        stderr: () => undefined,
      },
    );
    expect(code).toEqual(err(failure));
  });
});
