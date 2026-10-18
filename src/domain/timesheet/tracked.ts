import type { EntryId, TimerId, WorkspaceId } from "../shared/ids";
import type { Duration, Timestamp } from "../shared/time";
import type { IssueKey } from "../work/issue-key";
import type { Workspace } from "../workspace/workspace";
import type { Category, EntryNote, TimeEntry } from "./entry";
import { groupScope, scopeKey, scopeOf, type TimesheetScope } from "./scope";

/** Where a span of tracked time is kept: a segment of a timer, or an entry added by hand. */
export type SpanSource =
  | { readonly kind: "timer"; readonly id: TimerId; readonly position: number }
  | { readonly kind: "entry"; readonly id: EntryId };

/** One stretch of tracked time with what it was tracked against; open while the timer runs. */
export interface TrackedSpan {
  readonly source: SpanSource;
  /** Null only for an entry on a whole group. */
  readonly workspaceId: WorkspaceId | null;
  /**
   * The timesheet it counts on. Storage knows only a span's workspace, so it says the workspace's
   * own; `withScopes` moves it to the workspace's group.
   */
  readonly scope: TimesheetScope;
  readonly issueKey: IssueKey | null;
  /** Only entries have one, when they are not on an issue. */
  readonly category: Category | null;
  readonly start: Timestamp;
  readonly end: Timestamp | null;
  readonly note: EntryNote | null;
}

/** Time tracked against an issue or a category, or a workspace when neither was given. */
export interface TrackedTotal {
  readonly scope: TimesheetScope;
  readonly workspaceId: WorkspaceId | null;
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
    // An entry is on a group or a workspace, one of them (`timeEntry`).
    scope:
      entry.group === null
        ? scopeOf({ id: entry.workspaceId as WorkspaceId, group: null })
        : groupScope(entry.group),
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
    const key = [
      scopeKey(span.scope),
      span.workspaceId ?? "",
      span.issueKey ?? "",
      span.category ?? "",
    ].join("\u0000");
    const sum = (totals.get(key)?.duration ?? 0) + (end - start);
    totals.set(key, {
      scope: span.scope,
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
      (a.workspaceId ?? "").localeCompare(b.workspaceId ?? ""),
  );
}

/** Spans on the timesheets their workspaces are on now: each one's group, or its own when none. */
export function withScopes(
  spans: readonly TrackedSpan[],
  workspaces: ReadonlyMap<string, Pick<Workspace, "group">>,
): TrackedSpan[] {
  return spans.map((span) =>
    span.workspaceId === null
      ? span
      : {
          ...span,
          scope: scopeOf({
            id: span.workspaceId,
            group: workspaces.get(span.workspaceId)?.group ?? null,
          }),
        },
  );
}
