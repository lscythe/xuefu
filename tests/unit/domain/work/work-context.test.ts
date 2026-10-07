import { describe, expect, test } from "bun:test";
import type { WorkId, WorkspaceId } from "../../../../src/domain/shared/ids";
import type { Timestamp } from "../../../../src/domain/shared/time";
import type { IssueKey } from "../../../../src/domain/work/issue-key";
import {
  finishWork,
  type IssueTitle,
  issueTitle,
  retitleWork,
  startWork,
} from "../../../../src/domain/work/work-context";

const at = (seconds: number) => (1_760_000_000_000 + seconds * 1000) as Timestamp;
const work = startWork(
  {
    id: "w1" as WorkId,
    workspaceId: "mobile-banking" as WorkspaceId,
    issueKey: "MOB-2841" as IssueKey,
    title: null,
  },
  at(10),
);

describe("issueTitle", () => {
  test("trims and accepts any script", () => {
    expect(issueTitle("  Add biometric authentication ")).toEqual({
      ok: true,
      value: "Add biometric authentication" as IssueTitle,
    });
    expect(issueTitle("指纹登录").ok).toBe(true);
    expect(issueTitle("x".repeat(200)).ok).toBe(true);
  });

  test.each(["", "   ", "x".repeat(201), "line\nbreak"])("rejects %p", (raw) => {
    expect(issueTitle(raw)).toMatchObject({
      ok: false,
      error: { kind: "validation", issues: [{ path: "title" }] },
    });
  });
});

describe("work context", () => {
  test("starts open and frozen", () => {
    expect(work).toMatchObject({ startedAt: at(10), endedAt: null });
    expect(Object.isFrozen(work)).toBe(true);
  });

  test("finishes once, never before it started", () => {
    expect(finishWork(work, at(60))).toEqual({ ok: true, value: { ...work, endedAt: at(60) } });
    const finished = finishWork(work, at(0));
    expect(finished).toEqual({ ok: true, value: { ...work, endedAt: at(10) } });
    if (!finished.ok) return;
    expect(finishWork(finished.value, at(90))).toMatchObject({
      ok: false,
      error: { kind: "conflict", entity: "work", message: "Work on MOB-2841 has already finished" },
    });
  });

  test("a new title replaces the old one; no title keeps it", () => {
    const titled = retitleWork(work, "Biometrics" as IssueTitle);
    expect(titled.title).toBe("Biometrics" as IssueTitle);
    expect(retitleWork(titled, null)).toBe(titled);
    expect(retitleWork(titled, "Biometrics" as IssueTitle)).toBe(titled);
  });
});
