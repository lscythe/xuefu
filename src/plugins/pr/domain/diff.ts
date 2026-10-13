import { assertNever } from "../../../domain/shared/assert-never";
import type { CommentAnchor } from "./comment";

/** A line of a diff, with its number in the file before and after; null where it is not in one. */
export interface DiffLine {
  readonly kind: "added" | "removed" | "context";
  readonly text: string;
  readonly old: number | null;
  readonly new: number | null;
}

interface DiffHunk {
  /** The hunk's own heading line, such as "@@ -12,7 +12,9 @@ fun login()". */
  readonly header: string;
  readonly lines: readonly DiffLine[];
}

export type FileChange = "added" | "deleted" | "modified" | "renamed" | "copied";

/** One file a diff changes. */
export interface DiffFile {
  /** Its path before, and after; null for one added, or deleted. */
  readonly from: string | null;
  readonly to: string | null;
  readonly change: FileChange;
  /** Whether its content is not text, so no lines are shown. */
  readonly binary: boolean;
  readonly hunks: readonly DiffHunk[];
  readonly added: number;
  readonly removed: number;
}

/** The path a file is known by: where it ends up, or where it was when deleted. */
export const filePath = (file: Pick<DiffFile, "from" | "to">): string => file.to ?? file.from ?? "";

/** Where a comment on a line goes, or why it cannot go there. */
export type Placement =
  | { readonly kind: "placed"; readonly anchor: Omit<CommentAnchor, "outdated"> }
  /** No file of the diff is the one named; `near` are those with its name, if any. */
  | { readonly kind: "no-file"; readonly near: readonly string[] }
  /** The path, shortened, fits more than one file. */
  | { readonly kind: "ambiguous"; readonly paths: readonly string[] }
  /** The file is in the diff, but not that line: what it shows of it, after and before. */
  | {
      readonly kind: "no-line";
      readonly path: string;
      readonly shown: string;
      readonly removed: string;
    };

/** A path's names, leaving out what stands for some left out, such as "…". */
const segments = (path: string) =>
  path.split("/").filter((name) => name !== "" && name !== "." && !/^(\.\.\.|…)$/u.test(name));

/** Whether `wanted` are among `names`, in order, the last of each the same. */
function fits(wanted: readonly string[], names: readonly string[]): boolean {
  if (wanted.at(-1) !== names.at(-1)) return false;
  let at = 0;
  for (const name of names) if (name === wanted[at]) at += 1;
  return at === wanted.length;
}

/** Numbers as runs, such as "9-15, 40". */
function runs(numbers: readonly number[]): string {
  const sorted = [...new Set(numbers)].sort((a, b) => a - b);
  const parts: string[] = [];
  let start = sorted[0];
  for (let index = 0; index < sorted.length; index += 1) {
    const now = sorted[index] ?? 0;
    const next = sorted[index + 1];
    if (next === now + 1) continue;
    parts.push(start === now ? `${now}` : `${start}-${now}`);
    start = next;
  }
  return parts.join(", ");
}

/**
 * Where a comment on line `line` of `path` goes: in the file after, or with `side` "old" on a
 * removed line of the file before. A path cut short, as agents write them, such as
 * "feature/…/Login.kt" or one without "src/main/java", is taken for the one file it fits.
 */
export function placeComment(
  files: readonly DiffFile[],
  path: string,
  line: number,
  side: "old" | "new",
): Placement {
  const wanted = segments(path);
  const named = files.filter((candidate) =>
    [candidate.to, candidate.from].some(
      (each) => each !== null && segments(each).at(-1) === wanted.at(-1),
    ),
  );
  const exact = files.find((candidate) => filePath(candidate) === path || candidate.from === path);
  const fitting = named.filter((candidate) =>
    [candidate.to, candidate.from].some((each) => each !== null && fits(wanted, segments(each))),
  );
  const file = exact ?? (fitting.length === 1 ? fitting[0] : undefined);
  if (file === undefined) {
    return fitting.length > 1
      ? { kind: "ambiguous", paths: fitting.map(filePath) }
      : { kind: "no-file", near: named.map(filePath) };
  }
  const lines = file.hunks.flatMap((hunk) => hunk.lines);
  const found =
    side === "old"
      ? lines.find((shown) => shown.kind === "removed" && shown.old === line)
      : lines.find((shown) => shown.kind !== "removed" && shown.new === line);
  if (found === undefined) {
    return {
      kind: "no-line",
      path: filePath(file),
      shown: runs(lines.flatMap((shown) => (shown.new === null ? [] : [shown.new]))),
      removed: runs(
        lines.flatMap((shown) =>
          shown.kind === "removed" && shown.old !== null ? [shown.old] : [],
        ),
      ),
    };
  }
  return { kind: "placed", anchor: { path: filePath(file), line, side, lineKind: found.kind } };
}

/**
 * Why a comment could not be placed, saying what would: the file meant, or the lines the diff
 * shows. `old` is how a removed line is asked for, such as "--old".
 */
export function placementProblem(
  placement: Exclude<Placement, { kind: "placed" }>,
  path: string,
  line: number,
  side: "old" | "new",
  old: string,
): string {
  switch (placement.kind) {
    case "no-file":
      return placement.near.length === 0
        ? `${path} is not in the diff`
        : `${path} is not in the diff; did you mean ${placement.near.join(" or ")}?`;
    case "ambiguous":
      return `${path} could be ${placement.paths.join(" or ")}; give its whole path`;
    case "no-line": {
      const where = `line ${line} of ${placement.path}`;
      if (side === "old") {
        return placement.removed === ""
          ? `${where} as it was is not removed in the diff, which removes nothing of it`
          : `${where} as it was is not removed in the diff, which removes lines ${placement.removed}`;
      }
      const shown = placement.shown === "" ? "" : `, which shows lines ${placement.shown} of it`;
      return `${where} is not in the diff${shown}; for a removed line, add ${old}`;
    }
    default:
      return assertNever(placement);
  }
}

const HUNK = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

/** A path as git writes it after a/ or b/, unquoted; null for /dev/null. */
function gitPath(raw: string, prefix: "a/" | "b/"): string | null {
  let path = raw.trim();
  if (path.startsWith('"') && path.endsWith('"')) {
    path = path.slice(1, -1).replace(/\\(["\\])/g, "$1");
  }
  if (path === "/dev/null") return null;
  return path.startsWith(prefix) ? path.slice(prefix.length) : path;
}

interface Building {
  from: string | null;
  to: string | null;
  change: FileChange;
  binary: boolean;
  hunks: { header: string; lines: DiffLine[] }[];
}

/**
 * Reads a unified diff as git writes it. Each hunk takes as many lines as its heading counts, so a
 * removed line that reads like a header is still read as a line.
 */
export function parseDiff(text: string): DiffFile[] {
  const files: Building[] = [];
  let file: Building | null = null;
  let oldLeft = 0;
  let newLeft = 0;
  let oldLine = 0;
  let newLine = 0;

  const start = (from: string | null, to: string | null): Building => {
    const next: Building = { from, to, change: "modified", binary: false, hunks: [] };
    files.push(next);
    return next;
  };

  for (const raw of text.split("\n")) {
    const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
    const hunk = file?.hunks.at(-1);
    if (hunk !== undefined && (oldLeft > 0 || newLeft > 0)) {
      const sign = line[0] ?? " ";
      const content = line.slice(1);
      if (sign === "\\") continue; // "\ No newline at end of file"
      if (sign === "+") {
        hunk.lines.push({ kind: "added", text: content, old: null, new: newLine });
        newLine += 1;
        newLeft -= 1;
      } else if (sign === "-") {
        hunk.lines.push({ kind: "removed", text: content, old: oldLine, new: null });
        oldLine += 1;
        oldLeft -= 1;
      } else {
        hunk.lines.push({ kind: "context", text: content, old: oldLine, new: newLine });
        oldLine += 1;
        newLine += 1;
        oldLeft -= 1;
        newLeft -= 1;
      }
      continue;
    }
    if (line.startsWith("diff --git ")) {
      const paths = /^diff --git (a\/.*) (b\/.*)$/.exec(line);
      file = start(gitPath(paths?.[1] ?? "", "a/"), gitPath(paths?.[2] ?? "", "b/"));
    } else if (line.startsWith("--- ")) {
      // A diff without git's own headings starts each file here.
      if (file === null || file.hunks.length > 0) file = start(null, null);
      file.from = gitPath(line.slice(4).split("\t")[0] ?? "", "a/");
      if (file.from === null) file.change = "added";
    } else if (line.startsWith("+++ ") && file !== null) {
      file.to = gitPath(line.slice(4).split("\t")[0] ?? "", "b/");
      if (file.to === null) file.change = "deleted";
    } else if (file !== null && line.startsWith("new file mode")) {
      file.change = "added";
      file.from = null;
    } else if (file !== null && line.startsWith("deleted file mode")) {
      file.change = "deleted";
      file.to = null;
    } else if (file !== null && line.startsWith("rename from ")) {
      file.change = "renamed";
      file.from = line.slice("rename from ".length);
    } else if (file !== null && line.startsWith("rename to ")) {
      file.to = line.slice("rename to ".length);
    } else if (file !== null && line.startsWith("copy from ")) {
      file.change = "copied";
      file.from = line.slice("copy from ".length);
    } else if (file !== null && line.startsWith("copy to ")) {
      file.to = line.slice("copy to ".length);
    } else if (file !== null && (line.startsWith("Binary files ") || line === "GIT binary patch")) {
      file.binary = true;
    } else if (file !== null) {
      const heading = HUNK.exec(line);
      if (heading !== null) {
        oldLine = Number(heading[1]);
        oldLeft = heading[2] === undefined ? 1 : Number(heading[2]);
        newLine = Number(heading[3]);
        newLeft = heading[4] === undefined ? 1 : Number(heading[4]);
        file.hunks.push({ header: line, lines: [] });
      }
    }
  }

  return files.map((built) => {
    const lines = built.hunks.flatMap((hunk) => hunk.lines);
    return {
      ...built,
      added: lines.filter((line) => line.kind === "added").length,
      removed: lines.filter((line) => line.kind === "removed").length,
    };
  });
}
