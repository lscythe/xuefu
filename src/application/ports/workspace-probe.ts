import type { FileSystemError } from "../../domain/shared/errors";
import type { AbsolutePath } from "../../domain/shared/path";
import type { Result } from "../../domain/shared/result";

/** Tooling detected in a workspace folder; decides which panels and commands apply. */
export interface WorkspaceCapabilities {
  /** A git repository root (`.git` directory, or a `.git` file for worktrees). */
  readonly git: boolean;
  /** A Gradle build (`settings.gradle` or `settings.gradle.kts`), e.g. an Android project. */
  readonly gradle: boolean;
}

export interface ProbedDirectory {
  /** Symlinks resolved, so the same folder is never registered twice under different names. */
  readonly path: AbsolutePath;
  readonly capabilities: WorkspaceCapabilities;
}

export interface WorkspaceProbe {
  /** Fails when `path` does not exist, is not a directory or cannot be read. */
  probe(path: AbsolutePath): Promise<Result<ProbedDirectory, FileSystemError>>;
}
