import type { EntryId, TimerId, WorkspaceId } from "../shared/ids";
import type { Duration, Timestamp } from "../shared/time";
import type { IssueKey } from "../work/issue-key";
import type { Category, EntryNote, TimeEntry } from "./entry";

/** Where a span of tracked time is kept: a segment of a timer, or an entry added by hand. */
export type SpanSource =
  | { readonly kind: "timer"; readonly id: TimerId; readonly position: number }
  | { readonly kind: "entry"; readonly id: EntryId };

/** One stretch of tracked time with what it was tracked against; open while the timer runs. */
export interface TrackedSpan {
  readonly source: SpanSource;
  readonly workspaceId: WorkspaceId;
  readonly issueKey: IssueKey | null;
  /** Only entries have one, when they are not on an issue. */
  readonly category: Category | null;
  readonly start: Timestamp;
  readonly end: Timestamp | null;
  readonly note: EntryNote | null;
}

/** Time tracked against an issue or a category, or a workspace when neither was given. */
export interface TrackedTotal {
  readonly workspaceId: WorkspaceId;
  readonly issueKey: IssueKey | null;
  readonly category: Category | null;
  readonly duration: Duration;
}

/** A span's id as people type it: an entry's own, or its timer's with the segment's place. */
export const spanId = (source: SpanSource): string =>
  source.kind === "entry" ? source.id : `${source.id}:${source.position}`;

export function entrySpan(entry: TimeEntry): TrackedSpan {
  return {
    source: { kind: "entry", id: entry.id },
    workspaceId: entry.workspaceId,
    issueKey: entry.issueKey,
    category: entry.category,
    start: entry.start,
    end: entry.end,
    note: entry.note,
  };
}

/**
 * Time tracked from `since` until `now`, per workspace and issue or category, most first. Spans
 * are cut at `since`, an open span counts up to `now`, and anything that adds up to nothing is
 * left out.
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
    const key = [span.workspaceId, span.issueKey ?? "", span.category ?? ""].join("\u0000");
    const sum = (totals.get(key)?.duration ?? 0) + (end - start);
    totals.set(key, {
      workspaceId: span.workspaceId,
      issueKey: span.issueKey,
      category: span.category,
      duration: sum as Duration,
    });
  }
  const label = (total: TrackedTotal) => total.issueKey ?? total.category ?? "";
  return [...totals.values()].sort(
    (a, b) =>
      b.duration - a.duration ||
      label(a).localeCompare(label(b)) ||
      a.workspaceId.localeCompare(b.workspaceId),
  );
}
