import { describe, expect, test } from "bun:test";
import { PLUGINS } from "../../../../src/bootstrap/plugins";
import { cockpitSections, type Section, sectionIcon } from "../../../../src/tui/shell/sections";

const plugin = (id: string, label: string, letter: string): Section => ({
  id,
  label,
  icons: { nerd: "\u{e725}", letter },
});

describe("cockpitSections", () => {
  test("the core's sections, with the plugins' between work and the timesheet", () => {
    const sections = cockpitSections([plugin("git", "Git", "G"), plugin("jira", "Jira", "J")]);
    expect(sections.map((s) => s.label)).toEqual([
      "Dashboard",
      "Work",
      "Git",
      "Jira",
      "Timesheet",
      "Activity",
      "Notes",
    ]);
  });

  test("every section, the plugins' included, has a distinct id and distinct icons", () => {
    const sections = cockpitSections(
      PLUGINS.map((p) => ({ id: p.id, label: p.label, icons: p.icons })),
    );
    expect(new Set(sections.map((s) => s.id)).size).toBe(sections.length);
    for (const set of ["nerd", "letter"] as const) {
      const icons = sections.map((s) => s.icons[set]);
      expect(new Set(icons).size).toBe(sections.length);
      for (const icon of icons) expect(Bun.stringWidth(icon)).toBe(1);
    }
  });

  test("letters are plain capitals and the nerd glyphs sit in the Private Use Area", () => {
    for (const { icons } of cockpitSections(PLUGINS)) {
      expect(icons.letter).toMatch(/^[A-Z]$/);
      expect(icons.nerd.codePointAt(0)).toBeGreaterThanOrEqual(0xe000);
      expect(icons.nerd.codePointAt(0)).toBeLessThanOrEqual(0xf8ff);
    }
  });
});

describe("sectionIcon", () => {
  test("Nerd Font glyphs need the nerd icon set; any other font gets the letter", () => {
    const [dashboard] = cockpitSections([]);
    if (dashboard === undefined) throw new Error("no sections");
    expect(sectionIcon(dashboard, "nerd")).toBe("\u{f009}");
    expect(sectionIcon(dashboard, "unicode")).toBe("D");
    expect(sectionIcon(dashboard, "ascii")).toBe("D");
  });
});
