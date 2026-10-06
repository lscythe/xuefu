import type { Brand } from "./brand";
import { type ValidationError, validationError } from "./errors";
import { err, ok, type Result } from "./result";

/** Normalised absolute POSIX path: no empty, `.` or `..` segments and no trailing slash. */
export type AbsolutePath = Brand<string, "AbsolutePath">;

const MAX_PATH_LENGTH = 4096;

function invalid(raw: string, message: string): Result<never, ValidationError> {
  return err(validationError("Path is invalid", [{ path: "path", message }], { raw }));
}

export function absolutePath(raw: string): Result<AbsolutePath, ValidationError> {
  if (!raw.startsWith("/")) return invalid(raw, "must be absolute (start with '/')");
  if (raw.includes("\0")) return invalid(raw, "must not contain NUL characters");
  if (raw.length > MAX_PATH_LENGTH) {
    return invalid(raw, `must be at most ${MAX_PATH_LENGTH} characters`);
  }
  if (raw !== "/") {
    const segments = raw.slice(1).split("/");
    if (segments.some((s) => s === "" || s === "." || s === "..")) {
      return invalid(raw, "must be normalised (no '//', '.', '..' or trailing '/')");
    }
  }
  return ok(raw as AbsolutePath);
}

/** True when `path` is `ancestor` or lies below it; compares whole segments, not string prefixes. */
export function isSameOrWithin(path: AbsolutePath, ancestor: AbsolutePath): boolean {
  if (path === ancestor || ancestor === "/") return true;
  return path.startsWith(`${ancestor}/`);
}

export function baseName(path: AbsolutePath): string {
  return path.slice(path.lastIndexOf("/") + 1);
}
