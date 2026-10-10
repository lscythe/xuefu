import type { Brand } from "../../../domain/shared/brand";
import { type ValidationError, validationError } from "../../../domain/shared/errors";
import { err, ok, type Result } from "../../../domain/shared/result";

/** A name git accepts for a branch, by the rules of `git check-ref-format --branch`. */
export type BranchName = Brand<string, "BranchName">;

const MAX_NAME = 250;
// Space, control characters, and what git gives meaning to: ~ ^ : ? * [ \
const FORBIDDEN = /[\s\p{Cc}~^:?*[\\]/u;

export function branchName(raw: string): Result<BranchName, ValidationError> {
  const parts = raw.split("/");
  const problem =
    raw === ""
      ? "must not be empty"
      : raw.length > MAX_NAME
        ? `must be at most ${MAX_NAME} characters`
        : FORBIDDEN.test(raw)
          ? "must not contain spaces or any of ~ ^ : ? * [ \\"
          : raw.startsWith("-")
            ? "must not start with a dash"
            : raw === "@" || raw.includes("..") || raw.includes("@{")
              ? 'must not be "@" or contain ".." or "@{"'
              : parts.some((part) => part === "" || part.startsWith(".") || part.endsWith(".lock"))
                ? 'each part between slashes must be non-empty, not start with "." or end with ".lock"'
                : raw.endsWith(".")
                  ? 'must not end with "."'
                  : null;
  if (problem !== null) {
    return err(validationError("Branch name is invalid", [{ path: "name", message: problem }]));
  }
  return ok(raw as BranchName);
}

/** A branch of the repository, here or on a remote. */
export interface Branch {
  /** As git names it in commands: "main", or "origin/main" for a remote's. */
  readonly name: string;
  /** The remote it lives on; null for a branch of this repository. */
  readonly remote: string | null;
  readonly current: boolean;
  /** The remote branch it tracks, as "origin/main". */
  readonly upstream: string | null;
  readonly ahead: number;
  readonly behind: number;
  /** The upstream was deleted on the remote. */
  readonly gone: boolean;
  /** When its last commit was made, in milliseconds since the epoch. */
  readonly committedAt: number;
  readonly subject: string;
}

/** Fields `git for-each-ref` writes for each branch, NUL between them. */
export const BRANCH_FORMAT = [
  "%(refname)",
  "%(HEAD)",
  "%(symref)",
  "%(upstream:short)",
  "%(upstream:track,nobracket)",
  "%(committerdate:unix)",
  "%(subject)",
].join("%00");

const malformed = (line: string) =>
  validationError("Unexpected git for-each-ref output", [
    { path: "branches", message: `cannot read "${line.slice(0, 80)}"` },
  ]);

const count = (track: string, word: "ahead" | "behind") =>
  Number(new RegExp(`${word} (\\d+)`).exec(track)?.[1] ?? 0);

/**
 * Reads branches listed with BRANCH_FORMAT, one per line. Symbolic refs such as origin/HEAD are
 * left out: they only point at another branch on the list.
 */
export function parseBranches(output: string): Result<Branch[], ValidationError> {
  const branches: Branch[] = [];
  for (const line of output.split("\n")) {
    if (line === "") continue;
    const fields = line.split("\0");
    const [ref, head, symref, upstream, track, date, ...subject] = fields;
    if (fields.length < 7 || ref === undefined || track === undefined) return err(malformed(line));
    if (symref !== "") continue;
    const local = ref.startsWith("refs/heads/");
    if (!local && !ref.startsWith("refs/remotes/")) return err(malformed(line));
    const name = ref.slice(local ? "refs/heads/".length : "refs/remotes/".length);
    branches.push({
      name,
      remote: local ? null : (name.split("/", 1)[0] ?? null),
      current: head === "*",
      upstream: upstream === "" || upstream === undefined ? null : upstream,
      ahead: count(track, "ahead"),
      behind: count(track, "behind"),
      gone: track === "gone",
      committedAt: Number(date) * 1000,
      subject: subject.join("\0"),
    });
  }
  return ok(branches);
}
