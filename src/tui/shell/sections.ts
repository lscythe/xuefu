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
  /** Single-column glyph; decorative, the label carries the meaning. */
  readonly icon: string;
}

export const SECTIONS: readonly Section[] = [
  { id: "dashboard", label: "Dashboard", icon: "⌂" },
  { id: "work", label: "Work", icon: "▤" },
  { id: "jira", label: "Jira", icon: "◆" },
  { id: "git", label: "Git", icon: "⎇" },
  { id: "pulls", label: "PRs", icon: "⇅" },
  { id: "timesheet", label: "Timesheet", icon: "◷" },
  { id: "jenkins", label: "Jenkins", icon: "⚙" },
  { id: "android", label: "Android", icon: "▣" },
  { id: "activity", label: "Activity", icon: "↗" },
  { id: "notes", label: "Notes", icon: "✎" },
];

export function sectionIcon(section: Section, icons: IconSet): string | null {
  return icons === "ascii" ? null : section.icon;
}

/** Moves `delta` steps through a list of `count` items, wrapping at both ends. */
export function cycle(index: number, delta: number, count: number): number {
  return (((index + delta) % count) + count) % count;
}
