import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { WorkspaceGuidance } from "../../application/ports/project-context";
import { fileSystemError } from "../../domain/shared/errors";
import { err, ok } from "../../domain/shared/result";

export function guidanceFiles(): WorkspaceGuidance {
  return {
    read(root, name) {
      const path = join(root, name);
      try {
        return ok(readFileSync(path, "utf8").trim() || null);
      } catch (cause) {
        if (
          typeof cause === "object" &&
          cause !== null &&
          "code" in cause &&
          cause.code === "ENOENT"
        ) {
          return ok(null);
        }
        return err(fileSystemError(`Unable to read ${name}`, path, "read", { cause }));
      }
    },
  };
}
