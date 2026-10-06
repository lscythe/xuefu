import type { z } from "zod";
import { type ValidationError, validationError } from "../../domain/shared/errors";
import type { DomainEvent } from "../../domain/shared/event";
import { err, ok, type Result } from "../../domain/shared/result";

export interface EventDefinition<
  TType extends string = string,
  TSchema extends z.ZodType = z.ZodType,
> {
  readonly type: TType;
  readonly version: number;
  readonly schema: TSchema;
}

export function defineEvent<TType extends string, TSchema extends z.ZodType>(
  type: TType,
  version: number,
  schema: TSchema,
): EventDefinition<TType, TSchema> {
  return Object.freeze({ type, version, schema });
}

const keyOf = (type: string, version: number) => `${type}@${version}`;

/** Registry of payload schemas used to validate events read back from the ledger. */
export class EventCatalog {
  private constructor(private readonly definitions: ReadonlyMap<string, EventDefinition>) {}

  static create(definitions: readonly EventDefinition[]): Result<EventCatalog, ValidationError> {
    const map = new Map<string, EventDefinition>();
    for (const definition of definitions) {
      const key = keyOf(definition.type, definition.version);
      if (map.has(key)) {
        return err(
          validationError(`Duplicate event definition ${key}`, [
            { path: key, message: "duplicate" },
          ]),
        );
      }
      map.set(key, definition);
    }
    return ok(new EventCatalog(map));
  }

  decode(event: DomainEvent): Result<DomainEvent, ValidationError> {
    const key = keyOf(event.type, event.version);
    const definition = this.definitions.get(key);
    if (definition === undefined) {
      return err(
        validationError(`Unknown event ${key}`, [{ path: "type", message: "not in catalog" }], {
          eventId: event.id,
        }),
      );
    }
    const parsed = definition.schema.safeParse(event.payload);
    if (!parsed.success) {
      return err(
        validationError(
          `Event ${key} has an invalid payload`,
          parsed.error.issues.map((i) => ({
            path: i.path.map(String).join("."),
            message: i.message,
          })),
          { eventId: event.id },
        ),
      );
    }
    return ok({ ...event, payload: parsed.data });
  }
}
