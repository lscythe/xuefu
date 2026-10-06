import { describe, expect, test } from "bun:test";
import { isLevelEnabled, type LogLevel } from "../../../../src/application/ports/logger";
import { createRedactor, SecretRegistry } from "../../../../src/application/security/redaction";
import { createLogger, type LogRecord } from "../../../../src/infrastructure/logging/logger";
import { MemorySink } from "../../../../src/infrastructure/logging/memory-sink";
import { ManualClock } from "../../../support/manual-clock";

function setup(level: LogLevel = "trace") {
  const registry = new SecretRegistry();
  const sinkResult = MemorySink.create(100);
  if (!sinkResult.ok) throw new Error("sink");
  const sink = sinkResult.value;
  const sinkErrors: unknown[] = [];
  const logger = createLogger({
    level,
    sinks: [sink],
    clock: new ManualClock(0),
    redactor: createRedactor(registry),
    onSinkError: (error) => sinkErrors.push(error),
  });
  return { logger, sink, registry, sinkErrors };
}

describe("isLevelEnabled", () => {
  test("orders trace < debug < info < warn < error", () => {
    expect(isLevelEnabled("info", "warn")).toBe(true);
    expect(isLevelEnabled("info", "info")).toBe(true);
    expect(isLevelEnabled("info", "debug")).toBe(false);
    expect(isLevelEnabled("error", "warn")).toBe(false);
    expect(isLevelEnabled("trace", "trace")).toBe(true);
  });
});

describe("logger", () => {
  test("writes structured records with ISO time, level and message", () => {
    const { logger, sink } = setup();
    logger.info("workspace opened", { workspace: "mobile-banking" });
    expect(sink.records()).toEqual([
      {
        time: "1970-01-01T00:00:00.000Z",
        level: "info",
        msg: "workspace opened",
        workspace: "mobile-banking",
      },
    ]);
  });

  test("every level method writes a record at that level", () => {
    const { logger, sink } = setup();
    logger.trace("t");
    logger.debug("d");
    logger.info("i");
    logger.warn("w");
    logger.error("e");
    expect(sink.records().map((r) => r.level)).toEqual(["trace", "debug", "info", "warn", "error"]);
  });

  test("filters records below the configured level", () => {
    const { logger, sink } = setup("warn");
    logger.debug("hidden");
    logger.info("hidden");
    logger.warn("shown");
    logger.error("shown too");
    expect(sink.records().map((r) => r.level)).toEqual(["warn", "error"]);
  });

  test("child loggers carry bindings such as correlation ids", () => {
    const { logger, sink } = setup();
    const child = logger.child({ correlationId: "corr-1", operation: "pr.create" });
    child.child({ integration: "bitbucket" }).info("request sent", { status: 201 });
    expect(sink.records()[0]).toMatchObject({
      correlationId: "corr-1",
      operation: "pr.create",
      integration: "bitbucket",
      status: 201,
    });
  });

  test("fields cannot overwrite reserved record keys", () => {
    const { logger, sink } = setup();
    logger.info("real message", { msg: "spoofed", level: "error", time: "x" });
    const record = sink.records()[0] as LogRecord;
    expect(record.msg).toBe("real message");
    expect(record.level).toBe("info");
    expect(record["_msg"]).toBe("spoofed");
    expect(record["_level"]).toBe("error");
  });

  test("invariant: secrets never reach sinks (message, fields or bindings)", () => {
    const { logger, sink, registry } = setup();
    registry.register("super-secret-jira-token-value");
    logger
      .child({ auth: "Bearer super-secret-jira-token-value" })
      .error("failed with super-secret-jira-token-value", {
        headers: { Authorization: "Basic Zm9vOmJhcg==" },
        token: "abc",
        url: "https://u:p@jira.example.com",
      });
    const serialised = JSON.stringify(sink.records());
    expect(serialised).not.toContain("super-secret-jira-token-value");
    expect(serialised).not.toContain("Zm9vOmJhcg==");
    expect(serialised).not.toContain("u:p@");
  });

  test("a failing sink is reported and does not stop other sinks or the caller", () => {
    const registry = new SecretRegistry();
    const good = MemorySink.create(10);
    if (!good.ok) throw new Error("sink");
    const reported: unknown[] = [];
    const logger = createLogger({
      level: "info",
      clock: new ManualClock(0),
      redactor: createRedactor(registry),
      sinks: [
        {
          name: "broken",
          write: () => {
            throw new Error("disk full");
          },
        },
        good.value,
      ],
      onSinkError: (error, sinkName) => reported.push({ sinkName, error: String(error) }),
    });
    expect(() => logger.info("still works")).not.toThrow();
    expect(good.value.records()).toHaveLength(1);
    expect(reported).toEqual([{ sinkName: "broken", error: "Error: disk full" }]);
  });
});

describe("MemorySink", () => {
  test("is bounded", () => {
    const sink = MemorySink.create(2);
    if (!sink.ok) throw new Error("sink");
    for (const msg of ["a", "b", "c"]) {
      sink.value.write({ time: "t", level: "info", msg });
    }
    expect(sink.value.records().map((r) => r.msg)).toEqual(["b", "c"]);
  });
});
