import { assertNever } from "../../../domain/shared/assert-never";
import type { PaletteToken } from "../../../tui/theme/palette";
import type { JiraIssue, StatusCategory } from "../domain/issue";

/** Jira's own colours for status categories: grey to do, blue in progress, green done. */
export function categoryTone(category: StatusCategory): PaletteToken {
  switch (category) {
    case "todo":
      return "textMuted";
    case "doing":
      return "info";
    case "done":
      return "success";
    default:
      return assertNever(category);
  }
}

/** Issues found by the query, and how many it matched in all. */
export interface FoundIssues {
  readonly issues: readonly JiraIssue[];
  readonly total: number;
}

/** How many issues are listed, for the panel's frame: "12 issues", or "50 of 73" when cut short. */
export function issueCount(found: FoundIssues): string {
  const shown = found.issues.length;
  return found.total > shown
    ? `${shown} of ${found.total}`
    : `${shown} ${shown === 1 ? "issue" : "issues"}`;
}

/** Widest a status may be before it is cut, so the summary keeps most of the row. */
const MAX_STATUS = 16;

/** Columns for the key and status, wide enough for every issue listed. */
export function issueColumns(issues: readonly JiraIssue[]): { key: number; status: number } {
  return {
    key: Math.max(0, ...issues.map((issue) => Bun.stringWidth(issue.key))),
    status: Math.min(
      MAX_STATUS,
      Math.max(0, ...issues.map((issue) => Bun.stringWidth(issue.status.name))),
    ),
  };
}
