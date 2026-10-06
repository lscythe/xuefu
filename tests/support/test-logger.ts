import type { Logger } from "../../src/application/ports/logger";
import { createRedactor, SecretRegistry } from "../../src/application/security/redaction";
import { createLogger } from "../../src/infrastructure/logging/logger";
import { MemorySink } from "../../src/infrastructure/logging/memory-sink";
import { ManualClock } from "./manual-clock";

/** Real logger writing to a bounded memory sink, for asserting on log output. */
export function testLogger(): { logger: Logger; sink: MemorySink } {
  const sink = MemorySink.create(500);
  if (!sink.ok) throw new Error("sink");
  const logger = createLogger({
    level: "trace",
    sinks: [sink.value],
    clock: new ManualClock(0),
    redactor: createRedactor(new SecretRegistry()),
    onSinkError: (error) => {
      throw error;
    },
  });
  return { logger, sink: sink.value };
}
