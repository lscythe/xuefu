import type { IdGenerator } from "../../application/ports/id-generator";
import {
  type CorrelationId,
  correlationId,
  type EventId,
  eventId,
  type TimerId,
  timerId,
} from "../../domain/shared/ids";

function mustParse<T>(
  parse: (raw: string) => { ok: true; value: T } | { ok: false },
  raw: string,
): T {
  const parsed = parse(raw);
  if (!parsed.ok) throw new Error(`Generated id failed validation: ${raw}`);
  return parsed.value;
}

/** UUIDv7 ids: globally unique and lexicographically ordered by creation time. */
export const uuidV7Ids: IdGenerator = {
  eventId: (): EventId => mustParse(eventId, Bun.randomUUIDv7()),
  correlationId: (): CorrelationId => mustParse(correlationId, Bun.randomUUIDv7()),
  timerId: (): TimerId => mustParse(timerId, Bun.randomUUIDv7()),
};
