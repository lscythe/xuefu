/** Compile-time exhaustiveness check that also fails loudly if an impossible value appears at runtime. */
export function assertNever(value: never): never {
  throw new Error(`Unexpected value: ${String(value)}`);
}
