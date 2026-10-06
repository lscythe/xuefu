import { describe, expect, test } from "bun:test";
import { createEvent } from "../../../../src/domain/shared/event";
import type { CorrelationId, EventId, WorkspaceId } from "../../../../src/domain/shared/ids";
import type { Timestamp } from "../../../../src/domain/shared/time";

describe("createEvent", () => {
  test("builds a frozen envelope with a frozen payload", () => {
    const event = createEvent({
      id: "evt-1" as EventId,
      type: "WorkStarted",
      version: 1,
      occurredAt: 1_000 as Timestamp,
      workspaceId: "mobile-banking" as WorkspaceId,
      correlationId: "corr-1" as CorrelationId,
      payload: { issueKey: "MOB-1" },
    });
    expect(event.type).toBe("WorkStarted");
    expect(Object.isFrozen(event)).toBe(true);
    expect(Object.isFrozen(event.payload)).toBe(true);
  });
});
