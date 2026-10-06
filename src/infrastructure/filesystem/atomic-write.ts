import { randomBytes } from "node:crypto";
import { link, open, rename, unlink } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { type FileSystemError, fileSystemError } from "../../domain/shared/errors";
import { err, ok, type Result } from "../../domain/shared/result";

export interface AtomicWriteOptions {
  /** When false the write fails with EEXIST instead of replacing an existing file. */
  readonly overwrite: boolean;
  readonly mode?: number;
}

function errnoCode(thrown: unknown): string | null {
  if (typeof thrown === "object" && thrown !== null && "code" in thrown) {
    const { code } = thrown as { code: unknown };
    return typeof code === "string" ? code : null;
  }
  return null;
}

async function fsyncDirectory(dir: string): Promise<void> {
  const handle = await open(dir, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

/**
 * Crash-safe write: data goes to a temp file in the same directory, is fsynced, then moved into
 * place with rename (overwrite) or link (no-clobber, atomic EEXIST). Readers see either the old or
 * the new file, never a partial one.
 */
export async function writeFileAtomic(
  path: string,
  data: string | Uint8Array,
  options: AtomicWriteOptions,
): Promise<Result<void, FileSystemError>> {
  const dir = dirname(path);
  const temp = join(dir, `.${basename(path)}.${randomBytes(6).toString("hex")}.tmp`);
  let tempCreated = false;

  try {
    const handle = await open(temp, "wx", options.mode ?? 0o644);
    tempCreated = true;
    try {
      await handle.writeFile(data);
      await handle.sync();
    } finally {
      await handle.close();
    }

    if (options.overwrite) {
      await rename(temp, path);
      tempCreated = false;
    } else {
      await link(temp, path);
      await unlink(temp);
      tempCreated = false;
    }
    await fsyncDirectory(dir);
    return ok(undefined);
  } catch (thrown) {
    const code = errnoCode(thrown);
    let cleanupFailed = false;
    if (tempCreated) {
      try {
        await unlink(temp);
      } catch {
        // Reported via context below; the primary failure is what the caller must handle.
        cleanupFailed = true;
      }
    }
    return err(
      fileSystemError(
        code === "EEXIST" ? "File already exists" : "Unable to write file",
        path,
        "write",
        {
          cause: thrown,
          context: { code, cleanupFailed, ...(cleanupFailed ? { tempFile: temp } : {}) },
          ...(code === "EEXIST"
            ? { hint: "Choose a different path or confirm that the existing file may be replaced" }
            : {}),
        },
      ),
    );
  }
}
