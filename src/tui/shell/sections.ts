import type { Component } from "solid-js";
import type { IconSet } from "../theme/status";
import type { SectionProps } from "./section-props";

/** A place in the navigation. */
export interface Section {
  readonly id: string;
  readonly label: string;
  /** Decorative, one column each; the label carries the meaning. */
  readonly icons: {
    /** A Nerd Font glyph, from the ranges that are the same in Nerd Fonts 2 and 3. */
    readonly nerd: string;
    /** For any other font: a capital, distinct across sections. */
    readonly letter: string;
  };
  /** Draws a plugin's section; the core's own sections are drawn by the shell. */
  readonly view?: Component<SectionProps>;
}

const DASHBOARD: Section = {
  id: "dashboard",
  label: "Dashboard",
  icons: { nerd: "\u{f009}", letter: "D" }, // fa-th_large
};
const WORK: Section = {
  id: "work",
  label: "Work",
  icons: { nerd: "\u{f0b1}", letter: "W" }, // fa-briefcase
};
const TIMESHEET: Section = {
  id: "timesheet",
  label: "Timesheet",
  icons: { nerd: "\u{f017}", letter: "T" }, // fa-clock
};
const ACTIVITY: Section = {
  id: "activity",
  label: "Activity",
  icons: { nerd: "\u{f469}", letter: "L" }, // oct-pulse
};
const NOTES: Section = {
  id: "notes",
  label: "Notes",
  icons: { nerd: "\u{f040}", letter: "N" }, // fa-pencil
};

/** The navigation: the core's sections, with the plugins' between work and the timesheet. */
export function cockpitSections(plugins: readonly Section[]): readonly Section[] {
  return [DASHBOARD, WORK, ...plugins, TIMESHEET, ACTIVITY, NOTES];
}

export function sectionIcon(section: Section, icons: IconSet): string {
  return icons === "nerd" ? section.icons.nerd : section.icons.letter;
}
