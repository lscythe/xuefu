import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { defineEvent, EventCatalog } from "../../../../src/application/events/catalog";
import { testEvent } from "../../../support/events";

const WorkStartedV1 = defineEvent("WorkStarted", 1, z.object({ issueKey: z.string() }));

function catalog() {
  const result = EventCatalog.create([WorkStartedV1]);
  if (!result.ok) throw new Error("catalog");
  return result.value;
}

describe("EventCatalog", () => {
  test("decodes a known event into its typed payload", () => {
    const decoded = catalog().decode(testEvent({ payload: { issueKey: "MOB-1" } }));
    expect(decoded.ok && decoded.value.payload).toEqual({ issueKey: "MOB-1" });
  });

  test("rejects payloads that do not match the registered schema", () => {
    const decoded = catalog().decode(testEvent({ payload: { issue: 42 } }));
    expect(decoded.ok).toBe(false);
    if (!decoded.ok) expect(decoded.error.kind).toBe("validation");
  });

  test("unknown types or versions are reported, not dropped", () => {
    const unknownType = catalog().decode(testEvent({ type: "FromTheFuture" }));
    const unknownVersion = catalog().decode(testEvent({ version: 9 }));
    expect(!unknownType.ok && unknownType.error.message).toContain("FromTheFuture@1");
    expect(!unknownVersion.ok && unknownVersion.error.message).toContain("WorkStarted@9");
  });

  test("duplicate definitions are rejected", () => {
    expect(EventCatalog.create([WorkStartedV1, WorkStartedV1]).ok).toBe(false);
  });
});
