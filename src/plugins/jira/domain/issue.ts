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

/** Jira's status category keys: "new", "indeterminate" and "done". */
export function statusCategory(key: string): StatusCategory {
  return key === "done" ? "done" : key === "indeterminate" ? "doing" : "todo";
}

/** The query for issues assigned to whoever the token belongs to that are not done. */
export const MY_OPEN_ISSUES =
  "assignee = currentUser() AND statusCategory != Done ORDER BY updated DESC";
