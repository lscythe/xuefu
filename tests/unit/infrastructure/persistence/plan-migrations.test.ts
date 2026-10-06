import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import {
  type MigrationDescriptor,
  planMigrations,
} from "../../../../src/infrastructure/persistence/migrations/plan";

const known = (n: number): MigrationDescriptor[] =>
  Array.from({ length: n }, (_, i) => ({
    version: i + 1,
    name: `m${i + 1}`,
    checksum: `c${i + 1}`,
  }));

function expectFailure(result: ReturnType<typeof planMigrations>) {
  if (result.ok) throw new Error("expected failure");
  return result.error;
}

describe("planMigrations", () => {
  test("a fresh database needs every migration", () => {
    expect(planMigrations(known(3), [])).toEqual({
      ok: true,
      value: { currentVersion: 0, targetVersion: 3, pending: [1, 2, 3] },
    });
  });

  test("an up-to-date database needs nothing", () => {
    const result = planMigrations(known(2), known(2));
    expect(result.ok && result.value.pending).toEqual([]);
  });

  test("known migrations must be contiguous from 1", () => {
    const gap = [known(3)[0], known(3)[2]] as MigrationDescriptor[];
    expect(expectFailure(planMigrations(gap, [])).reason).toBe("invalid-plan");
    expect(expectFailure(planMigrations([...known(2), ...known(1)], [])).reason).toBe(
      "invalid-plan",
    );
  });

  test("an edited, already-applied migration is detected", () => {
    const applied = [{ version: 1, name: "m1", checksum: "tampered" }];
    const error = expectFailure(planMigrations(known(2), applied));
    expect(error.reason).toBe("checksum-mismatch");
    expect(error.version).toBe(1);
  });

  test("a database migrated by a newer XueFu is refused", () => {
    const error = expectFailure(planMigrations(known(2), known(3)));
    expect(error.reason).toBe("database-newer");
    expect(error.hint).toContain("Upgrade XueFu");
  });

  test("a hole in applied history is refused", () => {
    const applied = [known(3)[0], known(3)[2]] as MigrationDescriptor[];
    expect(expectFailure(planMigrations(known(3), applied)).reason).toBe("invalid-plan");
  });

  test("property: pending is exactly the versions after the applied prefix", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 30 }).chain((n) => fc.tuple(fc.constant(n), fc.nat({ max: n }))),
        ([n, k]) => {
          const result = planMigrations(known(n), known(k));
          expect(result.ok).toBe(true);
          if (result.ok) {
            expect(result.value.pending).toEqual(
              known(n)
                .slice(k)
                .map((m) => m.version),
            );
            expect(result.value.currentVersion).toBe(k);
            expect(result.value.targetVersion).toBe(n);
          }
        },
      ),
    );
  });
});
