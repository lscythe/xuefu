import { describe, expect, test } from "bun:test";
import { EventBus } from "../../../../src/application/events/event-bus";
import { createRedactor, SecretRegistry } from "../../../../src/application/security/redaction";
import type { DomainEvent } from "../../../../src/domain/shared/event";
import { createLogger } from "../../../../src/infrastructure/logging/logger";
import { MemorySink } from "../../../../src/infrastructure/logging/memory-sink";
import { testEvent } from "../../../support/events";
import { ManualClock } from "../../../support/manual-clock";

function setup() {
  const sink = MemorySink.create(50);
  if (!sink.ok) throw new Error("sink");
  const logger = createLogger({
    level: "trace",
    sinks: [sink.value],
    clock: new ManualClock(0),
    redactor: createRedactor(new SecretRegistry()),
    onSinkError: () => undefined,
  });
  return { bus: new EventBus(logger), sink: sink.value };
}

describe("EventBus", () => {
  test("delivers events to subscribers of their type and to wildcard subscribers", async () => {
    const { bus } = setup();
    const seen: string[] = [];
    bus.subscribe("WorkStarted", (e) => void seen.push(`typed:${e.type}`));
    bus.subscribe("*", (e) => void seen.push(`any:${e.type}`));
    bus.subscribe("TimerStarted", () => void seen.push("wrong"));
    await bus.publish([testEvent()]);
    expect(seen).toEqual(["typed:WorkStarted", "any:WorkStarted"]);
  });

  test("preserves event order and awaits async subscribers sequentially", async () => {
    const { bus } = setup();
    const seen: string[] = [];
    bus.subscribe("*", async (e) => {
      await Bun.sleep(e.type === "A" ? 5 : 0);
      seen.push(e.type);
    });
    await bus.publish([testEvent({ type: "A" }), testEvent({ type: "B" })]);
    expect(seen).toEqual(["A", "B"]);
  });

  test("a failing subscriber is isolated, logged and reported", async () => {
    const { bus, sink } = setup();
    const seen: string[] = [];
    bus.subscribe(
      "*",
      () => {
        throw new Error("projection broke");
      },
      "broken-projection",
    );
    bus.subscribe("*", () => Promise.reject(new Error("async broke")), "async-projection");
    bus.subscribe("*", (e) => void seen.push(e.id));
    const event = testEvent();
    const report = await bus.publish([event]);
    expect(seen).toEqual([event.id]);
    expect(report.failures).toEqual([
      {
        eventId: event.id,
        subscriber: "broken-projection",
        error: { name: "Error", message: "projection broke" },
      },
      {
        eventId: event.id,
        subscriber: "async-projection",
        error: { name: "Error", message: "async broke" },
      },
    ]);
    const errors = sink.records().filter((r) => r.level === "error");
    expect(errors).toHaveLength(2);
    expect(errors[0]).toMatchObject({
      correlationId: event.correlationId,
      eventType: "WorkStarted",
    });
  });

  test("unsubscribe stops delivery and is idempotent", async () => {
    const { bus } = setup();
    let calls = 0;
    const unsubscribe = bus.subscribe("*", () => {
      calls += 1;
    });
    await bus.publish([testEvent()]);
    unsubscribe();
    unsubscribe();
    await bus.publish([testEvent()]);
    expect(calls).toBe(1);
  });

  test("subscribers added during publish do not receive the in-flight event", async () => {
    const { bus } = setup();
    const late: DomainEvent[] = [];
    bus.subscribe("*", () => {
      bus.subscribe("*", (e) => void late.push(e));
    });
    await bus.publish([testEvent()]);
    expect(late).toEqual([]);
  });
});
