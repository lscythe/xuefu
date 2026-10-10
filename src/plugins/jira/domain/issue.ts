/** Where a status sits in Jira's three-way grouping, whatever the workflow names it. */
export type StatusCategory = "todo" | "doing" | "done";

export interface JiraIssue {
  readonly key: string;
  readonly summary: string;
  readonly status: { readonly name: string; readonly category: StatusCategory };
  readonly type: string;
  readonly priority: string | null;
  readonly assignee: string | null;
  readonly reporter: string | null;
  /** Milliseconds since the epoch. */
  readonly created: number;
  readonly updated: number;
  /** As written in Jira, in its wiki markup; null when there is none. */
  readonly description: string | null;
}

/** Longest title work takes; longer summaries are cut. */
const MAX_TITLE = 200;

/** A summary as the title of work on the issue: on one line, and cut to fit. */
export function workTitle(summary: string): string {
  const line = summary
    .replace(/\p{Cc}+/gu, " ")
    .replace(/ {2,}/g, " ")
    .trim();
  return line.length <= MAX_TITLE ? line : `${line.slice(0, MAX_TITLE - 1).trimEnd()}…`;
}

/** A move the issue's workflow allows from where it is now. */
export interface JiraTransition {
  readonly id: string;
  /** What the workflow calls the move, such as "Start Progress". */
  readonly name: string;
  readonly to: { readonly name: string; readonly category: StatusCategory };
}

/**
 * The move that starts work on an issue: one to a status in progress, preferring one whose name
 * says so, as workflows may offer several, such as In Progress and In Review. Null when there is
 * none.
 */
export function startTransition(transitions: readonly JiraTransition[]): JiraTransition | null {
  const doing = transitions.filter((transition) => transition.to.category === "doing");
  return (
    doing.find((transition) => /progress/i.test(transition.to.name)) ??
    doing.find((transition) => /progress|start/i.test(transition.name)) ??
    doing[0] ??
    null
  );
}

/** Jira's status category keys: "new", "indeterminate" and "done". */
export function statusCategory(key: string): StatusCategory {
  return key === "done" ? "done" : key === "indeterminate" ? "doing" : "todo";
}

/** The query for issues assigned to whoever the token belongs to that are not done. */
export const MY_OPEN_ISSUES =
  "assignee = currentUser() AND statusCategory != Done ORDER BY updated DESC";
