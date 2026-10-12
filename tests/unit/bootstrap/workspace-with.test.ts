import { describe, expect, test } from "bun:test";
import type { ProcessRunner, ProcessSpec } from "../../../src/application/ports/process-runner";
import { workspaceWith } from "../../../src/bootstrap/workspace-with";
import { storageError, timeout } from "../../../src/domain/shared/errors";
import type { WorkspaceId } from "../../../src/domain/shared/ids";
import type { AbsolutePath } from "../../../src/domain/shared/path";
import { err, ok } from "../../../src/domain/shared/result";
import type { Timestamp } from "../../../src/domain/shared/time";
import type { Workspace, WorkspaceName } from "../../../src/domain/workspace/workspace";

const workspace = (id: string): Workspace => ({
  id: id as WorkspaceId,
  name: id as WorkspaceName,
  path: `/work/${id}` as AbsolutePath,
  group: null,
  addedAt: 0 as Timestamp,
  lastActiveAt: null,
});
const XUEFU = workspace("xuefu");
const BRIMO = workspace("brimo");
const OTHER = workspace("other");

/** git as each folder answers it: its origin, or a failure. */
function git(origins: Readonly<Record<string, string | "fails" | "times out">>) {
  const asked: ProcessSpec[] = [];
  const processes: ProcessRunner = {
    run: (spec) => {
      asked.push(spec);
      const origin = origins[spec.cwd] ?? "";
      if (origin === "times out") return Promise.resolve(err(timeout("git timed out", 5000)));
      return Promise.resolve(
        ok({
          exitCode: origin === "fails" ? 2 : 0,
          stdout: origin === "fails" ? "" : `${origin}\n`,
          stderr: "",
          durationMs: 1,
          truncated: false,
        }),
      );
    },
  };
  return { processes, asked };
}

const listing = (...all: Workspace[]) => ({
  list: () => Promise.resolve(ok(all.map((one) => ({ workspace: one })))),
});
const brimo = (origin: string) => origin.endsWith("/brimons/brimo-ns-android.git");

describe("workspaceWith", () => {
  test("the workspace whose clone is of the repository, though another is in front", async () => {
    const { processes, asked } = git({
      "/work/xuefu": "git@github.com:lscythe/xuefu.git",
      "/work/other": "fails",
      "/work/brimo": "ssh://git@bitbucket.example:7999/brimons/brimo-ns-android.git",
    });
    expect(
      await workspaceWith({ workspaces: listing(OTHER, XUEFU, BRIMO), processes })(brimo, XUEFU),
    ).toBe(BRIMO);
    // The one in front first, then the rest in order.
    expect(asked.map((spec): string => spec.cwd)).toEqual([
      "/work/xuefu",
      "/work/other",
      "/work/brimo",
    ]);
    expect(asked[0]).toEqual({
      command: "git",
      args: ["remote", "get-url", "origin"],
      cwd: "/work/xuefu" as AbsolutePath,
    });
  });

  test("the one in front when it is a clone, without asking the others", async () => {
    const { processes, asked } = git({
      "/work/brimo": "ssh://git@bitbucket.example:7999/brimons/brimo-ns-android.git",
    });
    expect(
      await workspaceWith({ workspaces: listing(XUEFU, BRIMO), processes })(brimo, BRIMO),
    ).toBe(BRIMO);
    expect(asked).toHaveLength(1);
  });

  test("none when no workspace is a clone, git fails, or workspaces cannot be listed", async () => {
    const { processes } = git({ "/work/xuefu": "times out", "/work/other": "fails" });
    expect(
      await workspaceWith({ workspaces: listing(XUEFU, OTHER), processes })(brimo, XUEFU),
    ).toBeNull();
    const unlisted = {
      list: () => Promise.resolve(err(storageError("Unable to read workspaces", "load"))),
    };
    expect(
      await workspaceWith({ workspaces: unlisted, processes: git({}).processes })(brimo, XUEFU),
    ).toBeNull();
  });
});
