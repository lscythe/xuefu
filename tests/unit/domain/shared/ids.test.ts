import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import {
  correlationId,
  eventId,
  noteId,
  timerId,
  workId,
  workspaceId,
} from "../../../../src/domain/shared/ids";

describe("EventId / CorrelationId / TimerId / WorkId / NoteId", () => {
  test("accept UUIDs and token-like ids", () => {
    expect(eventId("0199b6f2-6a3e-7c1d-9f00-1a2b3c4d5e6f").ok).toBe(true);
    expect(correlationId("cmd_abc-123").ok).toBe(true);
    expect(timerId("0199b6f2-6a3e-7c1d-9f00-1a2b3c4d5e6f").ok).toBe(true);
    expect(workId("wrk_1").ok).toBe(true);
    expect(noteId("not_1").ok).toBe(true);
  });

  test.each(["", " ", "has space", "semi;colon", "x".repeat(129), "ünïcode"])("reject %p", (v) => {
    expect(eventId(v).ok).toBe(false);
    expect(correlationId(v).ok).toBe(false);
    expect(timerId(v).ok).toBe(false);
    expect(workId(v).ok).toBe(false);
    expect(noteId(v).ok).toBe(false);
  });
});

describe("WorkspaceId", () => {
  test.each(["mobile-banking", "a", "auth-service-2", "0day"])("accepts %p", (v) => {
    expect(workspaceId(v).ok).toBe(true);
  });

  test.each(["", "Mobile", "-lead", "under_score", "a".repeat(65), "space here", "../escape"])(
    "rejects %p",
    (v) => {
      const result = workspaceId(v);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.message).toContain("Workspace id");
    },
  );

  test("property: any accepted id is safe as a path segment", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 80 }), (raw) => {
        const result = workspaceId(raw);
        if (result.ok) {
          expect(result.value).not.toContain("/");
          expect(result.value).not.toContain("..");
          expect(result.value.length).toBeLessThanOrEqual(64);
        }
      }),
    );
  });
});
