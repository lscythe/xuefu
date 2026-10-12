import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ProjectBrief, ProjectBriefs } from "../../application/ports/project-context";
import { fileSystemError } from "../../domain/shared/errors";
import type { WorkspaceId } from "../../domain/shared/ids";
import { fromThrowable, ok } from "../../domain/shared/result";
import type { Timestamp } from "../../domain/shared/time";

/**
 * Briefs as JSON files, one a workspace, in a folder of XueFu's data that only you can read. A
 * file that is missing or cannot be made sense of is no brief, so the workspace is studied again.
 */
export function briefFiles(dir: string): ProjectBriefs {
  const file = (workspace: WorkspaceId) => join(dir, `${workspace}.json`);
  return {
    find(workspace) {
      const path = file(workspace);
      if (!existsSync(path)) return ok(null);
      const read = fromThrowable(
        () => readFileSync(path, "utf8"),
        (thrown) =>
          fileSystemError("Unable to read a project brief", path, "read", { cause: thrown }),
      );
      if (!read.ok) return read;
      try {
        const stored = JSON.parse(read.value) as Record<string, unknown>;
        const { text, createdAt } = stored;
        return typeof text === "string" && typeof createdAt === "number"
          ? ok({ workspaceId: workspace, text, createdAt: createdAt as Timestamp })
          : ok(null);
      } catch {
        return ok(null);
      }
    },
    save(brief: ProjectBrief) {
      const path = file(brief.workspaceId);
      return fromThrowable(
        () => {
          mkdirSync(dir, { recursive: true, mode: 0o700 });
          writeFileSync(
            path,
            `${JSON.stringify({ text: brief.text, createdAt: brief.createdAt }, null, 2)}\n`,
            { mode: 0o600 },
          );
        },
        (thrown) =>
          fileSystemError("Unable to keep the project brief", path, "write", { cause: thrown }),
      );
    },
  };
}
