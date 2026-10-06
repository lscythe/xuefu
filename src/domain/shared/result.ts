export interface Ok<T> {
  readonly ok: true;
  readonly value: T;
}

export interface Err<E> {
  readonly ok: false;
  readonly error: E;
}

/** Explicit success/failure value. Expected failures are returned, never thrown. */
export type Result<T, E> = Ok<T> | Err<E>;

export type AsyncResult<T, E> = Promise<Result<T, E>>;

export function ok<T>(value: T): Ok<T> {
  return Object.freeze({ ok: true, value });
}

export function err<E>(error: E): Err<E> {
  return Object.freeze({ ok: false, error });
}

export function isOk<T, E>(result: Result<T, E>): result is Ok<T> {
  return result.ok;
}

export function isErr<T, E>(result: Result<T, E>): result is Err<E> {
  return !result.ok;
}

export function map<T, U, E>(result: Result<T, E>, fn: (value: T) => U): Result<U, E> {
  return result.ok ? ok(fn(result.value)) : result;
}

export function mapErr<T, E, F>(result: Result<T, E>, fn: (error: E) => F): Result<T, F> {
  return result.ok ? result : err(fn(result.error));
}

export function andThen<T, U, E, F>(
  result: Result<T, E>,
  fn: (value: T) => Result<U, F>,
): Result<U, E | F> {
  return result.ok ? fn(result.value) : result;
}

export function unwrapOr<T, E>(result: Result<T, E>, fallback: T): T {
  return result.ok ? result.value : fallback;
}

export function match<T, E, R>(
  result: Result<T, E>,
  branches: { readonly ok: (value: T) => R; readonly err: (error: E) => R },
): R {
  return result.ok ? branches.ok(result.value) : branches.err(result.error);
}

/** Collects all values, or returns the first error in input order. */
export function all<T, E>(results: readonly Result<T, E>[]): Result<T[], E> {
  const values: T[] = [];
  for (const result of results) {
    if (!result.ok) return result;
    values.push(result.value);
  }
  return ok(values);
}

/** Boundary helper: run code that may throw (third-party APIs) and capture the throw as an error. */
export function fromThrowable<T, E>(fn: () => T, onThrow: (thrown: unknown) => E): Result<T, E> {
  try {
    return ok(fn());
  } catch (thrown) {
    return err(onThrow(thrown));
  }
}

export async function fromThrowableAsync<T, E>(
  fn: () => Promise<T>,
  onThrow: (thrown: unknown) => E,
): AsyncResult<T, E> {
  try {
    return ok(await fn());
  } catch (thrown) {
    return err(onThrow(thrown));
  }
}
