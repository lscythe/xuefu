declare const BRAND: unique symbol;

/**
 * Nominal typing for primitives. Values are branded only inside smart constructors after
 * validation; that `as` cast is the single sanctioned escape hatch for branded types.
 */
export type Brand<T, B extends string> = T & { readonly [BRAND]: B };
