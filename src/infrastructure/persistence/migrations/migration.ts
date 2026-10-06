/**
 * A schema change. SQL must not contain transaction control, PRAGMA or VACUUM: the runner wraps
 * each migration and its bookkeeping row in a single transaction.
 */
export interface Migration {
  readonly version: number;
  readonly name: string;
  readonly sql: string;
}
