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

  test("ids and both icon sets are unique, and every icon is one column wide", () => {
    expect(new Set(SECTIONS.map((s) => s.id)).size).toBe(SECTIONS.length);
    for (const set of ["nerd", "letter"] as const) {
      const icons = SECTIONS.map((s) => s.icons[set]);
      expect(new Set(icons).size).toBe(SECTIONS.length);
      for (const icon of icons) expect(Bun.stringWidth(icon)).toBe(1);
    }
  });

  test("Nerd Font glyphs need the nerd icon set; any other font gets the letter", () => {
    const [dashboard] = SECTIONS;
    if (dashboard === undefined) throw new Error("no sections");
    expect(sectionIcon(dashboard, "nerd")).toBe("\u{f009}");
    expect(sectionIcon(dashboard, "unicode")).toBe("D");
    expect(sectionIcon(dashboard, "ascii")).toBe("D");
  });

  test("letters are plain ASCII capitals and the nerd glyphs sit in the Private Use Area", () => {
    for (const { icons } of SECTIONS) {
      expect(icons.letter).toMatch(/^[A-Z]$/);
      expect(icons.nerd.codePointAt(0)).toBeGreaterThanOrEqual(0xe000);
      expect(icons.nerd.codePointAt(0)).toBeLessThanOrEqual(0xf8ff);
    }
  });
});
