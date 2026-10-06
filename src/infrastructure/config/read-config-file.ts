import { readFile } from "node:fs/promises";
import { type FileSystemError, fileSystemError } from "../../domain/shared/errors";
import { err, ok, type Result } from "../../domain/shared/result";

export interface ConfigFile {
  readonly path: string;
  /** null when the file does not exist; an absent config file is valid. */
  readonly text: string | null;
}

export async function readConfigFile(path: string): Promise<Result<ConfigFile, FileSystemError>> {
  try {
    return ok({ path, text: await readFile(path, "utf8") });
  } catch (thrown) {
    if (
      typeof thrown === "object" &&
      thrown !== null &&
      "code" in thrown &&
      thrown.code === "ENOENT"
    ) {
      return ok({ path, text: null });
    }
    return err(
      fileSystemError("Unable to read configuration file", path, "read", { cause: thrown }),
    );
  }
}
