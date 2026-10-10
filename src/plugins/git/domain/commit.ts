import type { Brand } from "../../../domain/shared/brand";
import { type ValidationError, validationError } from "../../../domain/shared/errors";
import { err, ok, type Result } from "../../../domain/shared/result";

/** A commit's message: a summary line, then any details. Never blank. */
export type CommitMessage = Brand<string, "CommitMessage">;

const MAX_MESSAGE = 20_000;
// Control characters other than tab and newline, which a message's lines are made of.
const CONTROL_CHARACTER = /[^\P{Cc}\t\n]/u;

/**
 * Accepts a message as typed or pasted: line endings are made plain, and blank lines before and
 * whitespace after the text are dropped, as git itself would.
 */
export function commitMessage(raw: string): Result<CommitMessage, ValidationError> {
  const value = raw
    .replace(/\r\n?/g, "\n")
    .replace(/^(?:[ \t]*\n)+/, "")
    .trimEnd();
  const problem =
    value === ""
      ? "write a summary of the change"
      : value.length > MAX_MESSAGE
        ? `must be at most ${MAX_MESSAGE} characters`
        : CONTROL_CHARACTER.test(value)
          ? "must not contain control characters other than tabs"
          : null;
  if (problem !== null) {
    return err(
      validationError("Commit message is invalid", [{ path: "message", message: problem }]),
    );
  }
  return ok(value as CommitMessage);
}

/** The message's first line, which git shows as the commit's summary. */
export function commitSubject(message: CommitMessage): string {
  return message.split("\n", 1)[0] ?? "";
}

const MAX_PATH = 4096;

/**
 * A file as git status names it: relative to the repository's top, never empty, absolute or
 * reaching outside the repository.
 */
export function repositoryPath(raw: string): Result<string, ValidationError> {
  const problem =
    raw === ""
      ? "must not be empty"
      : raw.length > MAX_PATH
        ? `must be at most ${MAX_PATH} characters`
        : raw.includes("\0")
          ? "must not contain NUL"
          : raw.startsWith("/") || raw.split("/").includes("..")
            ? "must stay inside the repository"
            : null;
  if (problem !== null) {
    return err(validationError("Path is invalid", [{ path: "path", message: problem }]));
  }
  return ok(raw);
}
