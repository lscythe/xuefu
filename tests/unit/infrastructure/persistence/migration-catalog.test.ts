import { describe, expect, test } from "bun:test";
import { MIGRATIONS } from "../../../../src/infrastructure/persistence/migrations/catalog";

describe("migration catalog", () => {
  test("versions are contiguous from 1 and names are unique", () => {
    expect(MIGRATIONS.map((m) => m.version)).toEqual(MIGRATIONS.map((_, i) => i + 1));
    expect(new Set(MIGRATIONS.map((m) => m.name)).size).toBe(MIGRATIONS.length);
  });

  test.each(MIGRATIONS.map((m) => [m.version, m.name, m.sql] as const))(
    "migration %i (%s) contains no transaction control, PRAGMA, VACUUM or ATTACH",
    (_version, _name, sql) => {
      expect(sql).not.toMatch(
        /\b(BEGIN\s+(TRANSACTION|IMMEDIATE|EXCLUSIVE|DEFERRED)|COMMIT|ROLLBACK|PRAGMA|VACUUM|ATTACH|DETACH)\b/i,
      );
      expect(sql).not.toMatch(/^\s*BEGIN\s*;/im);
    },
  );
});
