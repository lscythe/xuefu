import { table } from "../../../cli/format";
import type { DiffFile, FileChange } from "../domain/diff";

const LETTERS: Readonly<Record<FileChange, string>> = {
  added: "A",
  deleted: "D",
  modified: "M",
  renamed: "R",
  copied: "C",
};

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/**
 * The files a diff changes, one a line with how it changed and the lines added and removed, then
 * the totals, as `git diff --stat` sums them up.
 */
export function diffStat(files: readonly DiffFile[]): string {
  if (files.length === 0) return "No changes.\n";
  const rows = files.map((file) => [
    LETTERS[file.change],
    file.from !== null && file.to !== null && file.from !== file.to
      ? `${file.from} → ${file.to}`
      : (file.to ?? file.from ?? ""),
    file.binary
      ? "binary"
      : [file.added > 0 ? `+${file.added}` : "", file.removed > 0 ? `-${file.removed}` : ""]
          .filter((part) => part !== "")
          .join(" "),
  ]);
  const added = files.reduce((sum, file) => sum + file.added, 0);
  const removed = files.reduce((sum, file) => sum + file.removed, 0);
  const lines = table(rows)
    .trimEnd()
    .split("\n")
    .map((line) => line.trimEnd());
  const totals = [
    plural(files.length, "file changed", "files changed"),
    plural(added, "line added", "lines added"),
    plural(removed, "line removed", "lines removed"),
  ].join(", ");
  return `${[...lines, totals].join("\n")}\n`;
}
