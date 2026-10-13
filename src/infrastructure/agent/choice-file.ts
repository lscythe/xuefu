import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { AgentChoices } from "../../application/ports/agent";
import { fileSystemError } from "../../domain/shared/errors";
import { fromThrowable } from "../../domain/shared/result";

/**
 * The agent and model chosen, as a JSON file in XueFu's data. One that is missing or cannot be
 * made sense of is no choice, so the first agent installed answers on its own default.
 */
export function choiceFile(path: string): AgentChoices {
  return {
    load() {
      try {
        if (!existsSync(path)) return null;
        const { agent, model } = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
        return typeof agent === "string" && (typeof model === "string" || model === null)
          ? { agent, model }
          : null;
      } catch {
        return null;
      }
    },
    save(choice) {
      return fromThrowable(
        () => {
          mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
          writeFileSync(path, `${JSON.stringify(choice)}\n`, { mode: 0o600 });
        },
        (thrown) =>
          fileSystemError("Unable to keep the agent chosen", path, "write", { cause: thrown }),
      );
    },
  };
}
