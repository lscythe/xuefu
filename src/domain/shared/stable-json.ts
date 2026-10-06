/**
 * Canonical JSON: object keys sorted recursively, so equal values always serialise identically.
 * Used for idempotency digests and content comparison of stored events.
 */
export function stableStringify(value: unknown): string {
  return JSON.stringify(canonicalise(value)) ?? "null";
}

function canonicalise(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalise);
  if (value !== null && typeof value === "object" && !(value instanceof Date)) {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      // defineProperty, not assignment: assigning "__proto__" would set the prototype instead.
      defineField(sorted, key, canonicalise((value as Record<string, unknown>)[key]));
    }
    return sorted;
  }
  return value;
}

/** Creates an own enumerable property even for keys like "__proto__". */
export function defineField(target: Record<string, unknown>, key: string, value: unknown): void {
  Object.defineProperty(target, key, {
    value,
    enumerable: true,
    writable: true,
    configurable: true,
  });
}
