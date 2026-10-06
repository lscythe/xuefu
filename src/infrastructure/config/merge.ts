export type PlainObject = Record<string, unknown>;

const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);

export function isPlainObject(value: unknown): value is PlainObject {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function copyInto(target: PlainObject, source: PlainObject): void {
  for (const [key, value] of Object.entries(source)) {
    // Prototype-polluting keys are rejected by strict schemas earlier; never copy them regardless.
    if (FORBIDDEN_KEYS.has(key) || value === undefined) continue;
    const existing = target[key];
    if (isPlainObject(value)) {
      const merged: PlainObject = {};
      if (isPlainObject(existing)) copyInto(merged, existing);
      copyInto(merged, value);
      target[key] = merged;
    } else {
      target[key] = value;
    }
  }
}

/**
 * Deterministic configuration precedence: later layers win. Plain objects merge recursively;
 * arrays and scalars are replaced wholesale; undefined never erases a lower layer. Inputs are not
 * mutated.
 */
export function mergeLayers(layers: readonly PlainObject[]): PlainObject {
  const result: PlainObject = {};
  for (const layer of layers) copyInto(result, layer);
  return result;
}
