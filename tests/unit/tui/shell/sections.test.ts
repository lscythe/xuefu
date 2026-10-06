import { describe, expect, test } from "bun:test";
import { SECTIONS, sectionIcon } from "../../../../src/tui/shell/sections";

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
