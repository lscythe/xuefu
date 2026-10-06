import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { type FileSystemError, fileSystemError } from "../../domain/shared/errors";
import { err, ok, type Result } from "../../domain/shared/result";

/**
 * Resolves `candidate` against `root` and rejects anything that would land outside it.
 * Lexical check only: callers writing into user-controlled trees must also refuse symlinks.
 */
export function resolveWithin(root: string, candidate: string): Result<string, FileSystemError> {
  if (!isAbsolute(root)) {
    return err(fileSystemError("Root directory must be absolute", root, "resolve"));
  }
  if (candidate.includes("\0")) {
    return err(fileSystemError("Path contains a NUL byte", root, "resolve"));
  }
  if (isAbsolute(candidate)) {
    return err(
      fileSystemError("Absolute paths are not allowed here", candidate, "resolve", {
        hint: `Use a path relative to ${root}`,
      }),
    );
  }
  const normalisedRoot = resolve(root);
  const resolved = resolve(normalisedRoot, candidate);
  const rel = relative(normalisedRoot, resolved);
  if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    return err(
      fileSystemError("Path escapes its allowed directory", candidate, "resolve", {
        context: { root: normalisedRoot },
      }),
    );
  }
  return ok(resolved);
}

/** Expands a leading `~` or `~/`; `~user` forms are left untouched. */
export function expandHome(path: string, home: string): string {
  if (path === "~") return home;
  if (path.startsWith("~/")) return join(home, path.slice(2));
  return path;
}
