import type { WorkspaceId } from "../shared/ids";
import type { Duration, Timestamp } from "../shared/time";
import type { IssueKey } from "../work/issue-key";

/** One stretch of tracked time with what it was tracked against; open while the timer runs. */
export interface TrackedSpan {
  readonly workspaceId: WorkspaceId;
  readonly issueKey: IssueKey | null;
  readonly start: Timestamp;
  readonly end: Timestamp | null;
}

/** Time tracked against an issue, or against a workspace when no issue was given. */
export interface TrackedTotal {
  readonly workspaceId: WorkspaceId;
  readonly issueKey: IssueKey | null;
  readonly duration: Duration;
}

/**
 * Time tracked from `since` until `now`, per workspace and issue, most first. Spans are cut at
 * `since`, an open span counts up to `now`, and anything that adds up to nothing is left out.
 */
export function trackedTotals(
  spans: readonly TrackedSpan[],
  since: Timestamp,
  now: Timestamp,
): TrackedTotal[] {
  const totals = new Map<string, TrackedTotal>();
  for (const span of spans) {
    const start = Math.max(span.start, since);
    const end = Math.min(span.end ?? now, now);
    if (end <= start) continue;
    const key = `${span.workspaceId}\u0000${span.issueKey ?? ""}`;
    const sum = (totals.get(key)?.duration ?? 0) + (end - start);
    totals.set(key, {
      workspaceId: span.workspaceId,
      issueKey: span.issueKey,
      duration: sum as Duration,
    });
  }
  return [...totals.values()].sort(
    (a, b) =>
      b.duration - a.duration ||
      (a.issueKey ?? "").localeCompare(b.issueKey ?? "") ||
      a.workspaceId.localeCompare(b.workspaceId),
  );
}
