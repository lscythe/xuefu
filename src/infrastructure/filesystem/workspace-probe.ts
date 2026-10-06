import { realpath, stat } from "node:fs/promises";
import { join } from "node:path";
import type {
  ProbedDirectory,
  WorkspaceCapabilities,
  WorkspaceProbe,
} from "../../application/ports/workspace-probe";
import { type FileSystemError, fileSystemError } from "../../domain/shared/errors";
import { type AbsolutePath, absolutePath } from "../../domain/shared/path";
import { err, ok, type Result } from "../../domain/shared/result";

function isMissing(thrown: unknown): boolean {
  return (
    typeof thrown === "object" && thrown !== null && "code" in thrown && thrown.code === "ENOENT"
  );
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function detect(path: string): Promise<WorkspaceCapabilities> {
  const [git, gradle, gradleKts] = await Promise.all([
    exists(join(path, ".git")),
    exists(join(path, "settings.gradle")),
    exists(join(path, "settings.gradle.kts")),
  ]);
  return { git, gradle: gradle || gradleKts };
}

/** Reads only metadata: never opens files or runs tools inside the workspace. */
export const fsWorkspaceProbe: WorkspaceProbe = {
  async probe(path: AbsolutePath): Promise<Result<ProbedDirectory, FileSystemError>> {
    let canonical: string;
    let isDirectory: boolean;
    try {
      canonical = await realpath(path);
      isDirectory = (await stat(canonical)).isDirectory();
    } catch (thrown) {
      const message = isMissing(thrown) ? "Folder does not exist" : "Unable to read folder";
      return err(fileSystemError(message, path, "realpath", { cause: thrown }));
    }
    if (!isDirectory) return err(fileSystemError("Not a folder", canonical, "stat"));
    // realpath output is already normalised; this only rejects pathological lengths.
    const resolved = absolutePath(canonical);
    if (!resolved.ok) return err(fileSystemError("Folder path is too long", canonical, "realpath"));
    return ok({ path: resolved.value, capabilities: await detect(resolved.value) });
  },
};
