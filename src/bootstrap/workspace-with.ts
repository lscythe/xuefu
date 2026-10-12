import type { AppError } from "../application/errors";
import type { ProcessRunner } from "../application/ports/process-runner";
import type { Result } from "../domain/shared/result";
import type { Workspace } from "../domain/workspace/workspace";

/** Long enough for git to read its config on a slow disk. */
const TIMEOUT_MS = 5000;

export interface WorkspaceWithDependencies {
  readonly workspaces: {
    list(): Promise<Result<readonly { readonly workspace: Workspace }[], AppError>>;
  };
  readonly processes: ProcessRunner;
}

/**
 * Finds the workspace whose clone's origin `holds` accepts, `first` tried before the others, so
 * the one in front wins when it is a clone; null when no workspace is, or they cannot be listed.
 */
export function workspaceWith(deps: WorkspaceWithDependencies) {
  return (holds: (origin: string) => boolean, first: Workspace) => find(deps, holds, first);
}

async function find(
  deps: WorkspaceWithDependencies,
  holds: (origin: string) => boolean,
  first: Workspace,
): Promise<Workspace | null> {
  const listed = await deps.workspaces.list();
  const others = listed.ok
    ? listed.value.map((view) => view.workspace).filter((one) => one.id !== first.id)
    : [];
  for (const workspace of [first, ...others]) {
    const ran = await deps.processes.run(
      { command: "git", args: ["remote", "get-url", "origin"], cwd: workspace.path },
      { timeoutMs: TIMEOUT_MS },
    );
    if (ran.ok && ran.value.exitCode === 0 && holds(ran.value.stdout.trim())) return workspace;
  }
  return null;
}
