import { describe, expect, test } from "bun:test";
import type { WorkspaceId } from "../../../../src/domain/shared/ids";
import type { Timestamp } from "../../../../src/domain/shared/time";
import { type TrackedSpan, trackedTotals } from "../../../../src/domain/timesheet/tracked";
import type { IssueKey } from "../../../../src/domain/work/issue-key";

const MINUTE = 60_000;
const at = (minutes: number) => (minutes * MINUTE) as Timestamp;
const span = (
  workspace: string,
  issue: string | null,
  start: number,
  end: number | null,
): TrackedSpan => ({
  workspaceId: workspace as WorkspaceId,
  issueKey: issue as IssueKey | null,
  start: at(start),
  end: end === null ? null : at(end),
});

describe("trackedTotals", () => {
  test("adds up each issue's spans, most first", () => {
    const totals = trackedTotals(
      [
        span("mobile", "MOB-1", 0, 30),
        span("mobile", "MOB-2", 30, 40),
        span("mobile", "MOB-1", 40, 70),
        span("auth", null, 70, 90),
      ],
      at(0),
      at(100),
    );
    expect(totals).toEqual([
      {
        workspaceId: "mobile" as WorkspaceId,
        issueKey: "MOB-1" as IssueKey,
        duration: 60 * MINUTE,
      },
      { workspaceId: "auth" as WorkspaceId, issueKey: null, duration: 20 * MINUTE },
      {
        workspaceId: "mobile" as WorkspaceId,
        issueKey: "MOB-2" as IssueKey,
        duration: 10 * MINUTE,
      },
    ] as unknown as ReturnType<typeof trackedTotals>);
  });

  test("cuts spans at the start, counts an open span up to now, and drops empty ones", () => {
    const totals = trackedTotals(
      [span("mobile", "MOB-1", 0, 20), span("mobile", "MOB-1", 50, null), span("x", null, 0, 5)],
      at(10),
      at(80),
    );
    expect<unknown>(totals.map((t) => [t.issueKey, t.duration / MINUTE])).toEqual([["MOB-1", 40]]);
  });

  test("the same issue in two workspaces is counted apart, ties ordered by key", () => {
    const totals = trackedTotals(
      [span("b", "MOB-1", 0, 10), span("a", "MOB-1", 10, 20), span("a", "ABC-1", 20, 30)],
      at(0),
      at(30),
    );
    expect(totals.map((t) => `${t.workspaceId}:${t.issueKey}`)).toEqual([
      "a:ABC-1",
      "a:MOB-1",
      "b:MOB-1",
    ]);
  });
});
