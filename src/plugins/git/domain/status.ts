import { assertNever } from "../../../domain/shared/assert-never";
import { type ValidationError, validationError } from "../../../domain/shared/errors";
import { err, ok, type Result } from "../../../domain/shared/result";

/** What happened to a file on one side, staged or not, as git's status letters say. */
export type FileChange =
  | "unchanged"
  | "modified"
  | "type-changed"
  | "added"
  | "deleted"
  | "renamed"
  | "copied";

/** A tracked file with changes, staged, not staged, or both. */
export interface ChangedFile {
  readonly path: string;
  /** Where a renamed or copied file came from. */
  readonly from: string | null;
  readonly staged: FileChange;
  readonly unstaged: FileChange;
}

export interface GitStatus {
  /** Null when HEAD is detached. */
  readonly branch: string | null;
  /** Null before the first commit. */
  readonly commit: string | null;
  readonly upstream: string | null;
  /** Commits on the branch that the upstream lacks, and the other way round. */
  readonly ahead: number;
  readonly behind: number;
  readonly changes: readonly ChangedFile[];
  /** Files with merge conflicts. */
  readonly conflicts: readonly string[];
  readonly untracked: readonly string[];
  readonly stashes: number;
}

const CHANGES: Readonly<Record<string, FileChange>> = {
  ".": "unchanged",
  M: "modified",
  T: "type-changed",
  A: "added",
  D: "deleted",
  R: "renamed",
  C: "copied",
};

function invalid(message: string): Result<never, ValidationError> {
  return err(
    validationError("git status printed something XueFu cannot read", [
      { path: "status", message },
    ]),
  );
}

/** Splits off `count` space-separated fields; the rest of the record is the path, spaces and all. */
function fields(record: string, count: number): { head: string[]; path: string } | null {
  const head: string[] = [];
  let at = 0;
  for (let i = 0; i < count; i += 1) {
    const space = record.indexOf(" ", at);
    if (space === -1) return null;
    head.push(record.slice(at, space));
    at = space + 1;
  }
  const path = record.slice(at);
  return path === "" ? null : { head, path };
}

function change(letter: string | undefined): FileChange | null {
  return letter !== undefined && Object.hasOwn(CHANGES, letter) ? (CHANGES[letter] ?? null) : null;
}

/**
 * Reads `git status --porcelain=v2 --branch --show-stash -z`: NUL-separated records, headers
 * first. Unknown headers are skipped, as git may add more; an unknown entry is an error.
 */
export function parseStatus(output: string): Result<GitStatus, ValidationError> {
  let branch: string | null = null;
  let commit: string | null = null;
  let upstream: string | null = null;
  let ahead = 0;
  let behind = 0;
  let stashes = 0;
  const changes: ChangedFile[] = [];
  const conflicts: string[] = [];
  const untracked: string[] = [];

  const records = output.split("\0");
  for (let i = 0; i < records.length; i += 1) {
    const record = records[i] ?? "";
    if (record === "") continue;
    if (record.startsWith("# ")) {
      const [key, ...rest] = record.slice(2).split(" ");
      const value = rest.join(" ");
      if (key === "branch.oid") commit = value === "(initial)" ? null : value;
      else if (key === "branch.head") branch = value === "(detached)" ? null : value;
      else if (key === "branch.upstream") upstream = value;
      else if (key === "branch.ab") {
        const counts = /^\+(\d+) -(\d+)$/.exec(value);
        if (counts === null) return invalid(`unreadable ahead/behind counts: ${value}`);
        ahead = Number(counts[1]);
        behind = Number(counts[2]);
      } else if (key === "stash") stashes = Number(value) || 0;
      continue;
    }
    const kind = record.slice(0, 2);
    if (kind === "? ") {
      untracked.push(record.slice(2));
      continue;
    }
    if (kind === "! ") continue;
    const shape = kind === "1 " ? 8 : kind === "2 " ? 9 : kind === "u " ? 10 : null;
    if (shape === null) return invalid(`unknown entry: ${record.slice(0, 2)}`);
    const parsed = fields(record, shape);
    if (parsed === null) return invalid(`incomplete entry: ${record.slice(0, 2)}`);
    if (kind === "u ") {
      conflicts.push(parsed.path);
      continue;
    }
    const [, xy = ""] = parsed.head;
    const staged = change(xy[0]);
    const unstaged = change(xy[1]);
    if (staged === null || unstaged === null) return invalid(`unknown change letters: ${xy}`);
    let from: string | null = null;
    if (kind === "2 ") {
      // A rename or copy carries its source as the next record.
      i += 1;
      from = records[i] ?? null;
      if (from === null || from === "") return invalid("a rename without its source");
    }
    changes.push({ path: parsed.path, from, staged, unstaged });
  }
  return ok({ branch, commit, upstream, ahead, behind, changes, conflicts, untracked, stashes });
}

/** Files with changes staged for the next commit. */
export const stagedFiles = (status: GitStatus): readonly ChangedFile[] =>
  status.changes.filter((file) => file.staged !== "unchanged");

/** Files with changes not yet staged. */
export const unstagedFiles = (status: GitStatus): readonly ChangedFile[] =>
  status.changes.filter((file) => file.unstaged !== "unchanged");

/** Nothing to commit, stage or resolve. */
export const isClean = (status: GitStatus): boolean =>
  status.changes.length === 0 && status.conflicts.length === 0 && status.untracked.length === 0;

/** git's letter for a change, as in `git status --short`. */
export function changeLetter(change: FileChange): string {
  switch (change) {
    case "unchanged":
      return " ";
    case "modified":
      return "M";
    case "type-changed":
      return "T";
    case "added":
      return "A";
    case "deleted":
      return "D";
    case "renamed":
      return "R";
    case "copied":
      return "C";
    default:
      return assertNever(change);
  }
}
