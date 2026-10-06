import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import { cycle, SECTIONS, sectionIcon } from "../../../../src/tui/shell/sections";

describe("SECTIONS", () => {
  test("lists the cockpit areas in navigation order, starting at the dashboard", () => {
    expect(SECTIONS.map((s) => s.label)).toEqual([
      "Dashboard",
      "Work",
      "Jira",
      "Git",
      "PRs",
      "Timesheet",
      "Jenkins",
      "Android",
      "Activity",
      "Notes",
    ]);
  });

  test("ids and icons are unique, and every icon is one column wide", () => {
    expect(new Set(SECTIONS.map((s) => s.id)).size).toBe(SECTIONS.length);
    expect(new Set(SECTIONS.map((s) => s.icon)).size).toBe(SECTIONS.length);
    for (const section of SECTIONS) expect(Bun.stringWidth(section.icon)).toBe(1);
  });

  test("ascii mode drops icons; the label always carries the meaning", () => {
    const [dashboard] = SECTIONS;
    if (dashboard === undefined) throw new Error("no sections");
    expect(sectionIcon(dashboard, "unicode")).toBe("⌂");
    expect(sectionIcon(dashboard, "nerd")).toBe("⌂");
    expect(sectionIcon(dashboard, "ascii")).toBeNull();
  });
});

describe("cycle", () => {
  test("wraps at both ends", () => {
    expect(cycle(0, -1, 10)).toBe(9);
    expect(cycle(9, 1, 10)).toBe(0);
    expect(cycle(3, 1, 10)).toBe(4);
  });

  test("property: always lands inside the list", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 50 }),
        fc.nat(),
        fc.integer({ min: -100, max: 100 }),
        (count, start, delta) => {
          const next = cycle(start % count, delta, count);
          expect(next).toBeGreaterThanOrEqual(0);
          expect(next).toBeLessThan(count);
        },
      ),
    );
  });
});
