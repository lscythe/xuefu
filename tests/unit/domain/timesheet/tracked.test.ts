import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import type { EntryId, TimerId, WorkspaceId } from "../../../../src/domain/shared/ids";
import type { Timestamp } from "../../../../src/domain/shared/time";
import type { Category, EntryNote } from "../../../../src/domain/timesheet/entry";
import { groupScope } from "../../../../src/domain/timesheet/scope";
import {
  entrySpan,
  spanId,
  type TrackedSpan,
  trackedTotals,
  withScopes,
} from "../../../../src/domain/timesheet/tracked";
import type { IssueKey } from "../../../../src/domain/work/issue-key";
import type { GroupName } from "../../../../src/domain/workspace/workspace";

const MINUTE = 60_000;
const at = (minutes: number) => (minutes * MINUTE) as Timestamp;
const span = (
  workspace: string,
  issue: string | null,
  start: number,
  end: number | null,
  kind: string | null = null,
): TrackedSpan => ({
  source: { kind: "timer", id: "t1" as TimerId, position: 0 },
  workspaceId: workspace as WorkspaceId,
  scope: { kind: "workspace", workspaceId: workspace as WorkspaceId },
  issueKey: issue as IssueKey | null,
  category: kind as Category | null,
  start: at(start),
  end: end === null ? null : at(end),
  note: null,
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
    const own = (id: string) => ({ kind: "workspace", workspaceId: id });
    expect<unknown>(totals).toEqual([
      {
        scope: own("mobile"),
        workspaceId: "mobile",
        issueKey: "MOB-1",
        category: null,
        duration: 60 * MINUTE,
      },
      {
        scope: own("auth"),
        workspaceId: "auth",
        issueKey: null,
        category: null,
        duration: 20 * MINUTE,
      },
      {
        scope: own("mobile"),
        workspaceId: "mobile",
        issueKey: "MOB-2",
        category: null,
        duration: 10 * MINUTE,
      },
    ]);
  });

  test("time on a whole group is counted per group", () => {
    const onGroup = (group: string, start: number, end: number) => ({
      ...span("mobile", null, start, end, "Meeting"),
      workspaceId: null,
      scope: groupScope(group as GroupName),
    });
    const totals = trackedTotals(
      [onGroup("Banking", 0, 20), onGroup("Ops", 20, 30), onGroup("Banking", 30, 40)],
      at(0),
      at(60),
    );
    expect<unknown>(totals.map((t) => [t.scope, t.workspaceId, t.duration / MINUTE])).toEqual([
      [{ kind: "group", group: "Banking" }, null, 30],
      [{ kind: "group", group: "Ops" }, null, 10],
    ]);
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

  test("time in a category is its own total, apart from the workspace's own", () => {
    const totals = trackedTotals(
      [
        span("mobile", null, 0, 20, "Meeting"),
        span("mobile", null, 20, 30),
        span("mobile", null, 30, 40, "Meeting"),
        span("mobile", null, 40, 50, "Review"),
      ],
      at(0),
      at(60),
    );
    expect<unknown>(totals.map((t) => [t.category, t.duration / MINUTE])).toEqual([
      ["Meeting", 30],
      [null, 10],
      ["Review", 10],
    ]);
  });

  test("the totals add up to the time the spans cover inside the window", () => {
    const spans = fc.array(
      fc.record({
        start: fc.integer({ min: 0, max: 200 }),
        length: fc.integer({ min: 0, max: 100 }),
        issue: fc.constantFrom("MOB-1", "MOB-2", null),
      }),
      { maxLength: 12 },
    );
    fc.assert(
      fc.property(spans, fc.integer({ min: 0, max: 150 }), (given, since) => {
        const now = 250;
        const tracked = given.map((s) => span("w", s.issue, s.start, s.start + s.length));
        const covered = given.reduce(
          (sum, s) =>
            sum + Math.max(0, Math.min(s.start + s.length, now) - Math.max(s.start, since)),
          0,
        );
        const totals = trackedTotals(tracked, at(since), at(now));
        expect(totals.reduce((sum, t) => sum + t.duration, 0)).toBe(covered * MINUTE);
      }),
    );
  });
});

describe("spans", () => {
  test("an entry is a span of its own, named by its id; a timer's by its id and place", () => {
    const entry = {
      id: "e1" as EntryId,
      workspaceId: "mobile" as WorkspaceId,
      group: null,
      issueKey: null,
      category: "Meeting" as Category,
      start: at(0),
      end: at(30),
      note: "Sprint planning" as EntryNote,
    };
    expect(entrySpan(entry)).toEqual({
      source: { kind: "entry", id: "e1" as EntryId },
      workspaceId: "mobile" as WorkspaceId,
      scope: { kind: "workspace", workspaceId: "mobile" as WorkspaceId },
      issueKey: null,
      category: "Meeting" as Category,
      start: at(0),
      end: at(30),
      note: "Sprint planning" as EntryNote,
    });
    expect(spanId(entrySpan(entry).source)).toBe("e1");
    expect(spanId({ kind: "timer", id: "t1" as TimerId, position: 2 })).toBe("t1:2");
    expect<unknown>(
      entrySpan({ ...entry, workspaceId: null, group: "Banking" as GroupName }),
    ).toMatchObject({ workspaceId: null, scope: { kind: "group", group: "Banking" } });
  });

  test("spans move to their workspace's group as it is now; one in no group keeps its own", () => {
    const banking = { group: "Banking" as GroupName };
    const spans = withScopes(
      [
        span("mobile", "MOB-1", 0, 30),
        span("side", null, 30, 40),
        span("removed", null, 40, 50),
        {
          ...span("mobile", null, 50, 60),
          workspaceId: null,
          scope: groupScope("Ops" as GroupName),
        },
      ],
      new Map<string, { group: GroupName | null }>([
        ["mobile", banking],
        ["side", { group: null }],
      ]),
    );
    expect<unknown>(spans.map((s) => s.scope)).toEqual([
      { kind: "group", group: "Banking" },
      { kind: "workspace", workspaceId: "side" },
      { kind: "workspace", workspaceId: "removed" },
      { kind: "group", group: "Ops" },
    ]);
  });
});
