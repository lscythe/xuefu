import type { IconSet } from "../theme/status";

type SectionId =
  | "dashboard"
  | "work"
  | "jira"
  | "git"
  | "pulls"
  | "timesheet"
  | "jenkins"
  | "android"
  | "activity"
  | "notes";

export interface Section {
  readonly id: SectionId;
  readonly label: string;
  /** Decorative, one column each; the label carries the meaning. */
  readonly icons: {
    /** A Nerd Font glyph, from the ranges that are the same in Nerd Fonts 2 and 3. */
    readonly nerd: string;
    /** For any other font: a capital, distinct across sections. */
    readonly letter: string;
  };
}

export const SECTIONS: readonly Section[] = [
  { id: "dashboard", label: "Dashboard", icons: { nerd: "\u{f009}", letter: "D" } }, // fa-th_large
  { id: "work", label: "Work", icons: { nerd: "\u{f0b1}", letter: "W" } }, // fa-briefcase
  { id: "jira", label: "Jira", icons: { nerd: "\u{e75c}", letter: "J" } }, // dev-jira
  { id: "git", label: "Git", icons: { nerd: "\u{e725}", letter: "G" } }, // dev-git_branch
  { id: "pulls", label: "PRs", icons: { nerd: "\u{f407}", letter: "P" } }, // oct-git_pull_request
  { id: "timesheet", label: "Timesheet", icons: { nerd: "\u{f017}", letter: "T" } }, // fa-clock
  { id: "jenkins", label: "Jenkins", icons: { nerd: "\u{f427}", letter: "C" } }, // oct-rocket
  { id: "android", label: "Android", icons: { nerd: "\u{e70e}", letter: "A" } }, // dev-android
  { id: "activity", label: "Activity", icons: { nerd: "\u{f469}", letter: "L" } }, // oct-pulse
  { id: "notes", label: "Notes", icons: { nerd: "\u{f040}", letter: "N" } }, // fa-pencil
];

export function sectionIcon(section: Section, icons: IconSet): string {
  return icons === "nerd" ? section.icons.nerd : section.icons.letter;
}
