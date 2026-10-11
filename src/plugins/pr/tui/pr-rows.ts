import type { PaletteToken } from "../../../tui/theme/palette";
import { type PullRequest, reviewSummary } from "../domain/pull-request";

/** One row of the section: a heading, a line of text, or a pull request to pick. */
export type PrRow =
  | { readonly kind: "heading"; readonly text: string }
  | { readonly kind: "note"; readonly text: string; readonly tone: PaletteToken }
  | { readonly kind: "pull"; readonly pull: PullRequest };

export type PullRow = Extract<PrRow, { kind: "pull" }>;

/** What the section has read, each part null until it is. */
export interface PrLists {
  /** The front workspace's branch: its pull request, or a note on why there is none. */
  readonly branch: PullRequest | string | null;
  readonly yours: readonly PullRequest[] | null;
  readonly toReview: readonly PullRequest[] | null;
}

/** "mobile-banking#42": short enough for a row, as one server rarely has two such names. */
export const shortRef = (pull: PullRequest) => `${pull.repository.slug}#${pull.id}`;

/** "1/2 approved", or "needs work" once a reviewer asks for changes, in the colour it deserves. */
export function reviewBadge(pull: PullRequest): {
  readonly text: string;
  readonly tone: PaletteToken;
} {
  const { approved, reviewers, needsWork } = reviewSummary(pull);
  if (needsWork > 0) return { text: "needs work", tone: "warning" };
  if (reviewers === 0) return { text: "no reviewers", tone: "textMuted" };
  return {
    text: `${approved}/${reviewers} approved`,
    tone: approved === reviewers ? "success" : "textMuted",
  };
}

/** The section's rows: this branch's pull request, then yours, then those waiting on you. */
export function prRows(lists: PrLists): PrRow[] {
  const group = (title: string, pulls: readonly PullRequest[] | null): PrRow[] =>
    pulls === null || pulls.length === 0
      ? []
      : [
          { kind: "note", text: "", tone: "text" },
          { kind: "heading", text: `${title} (${pulls.length})` },
          ...pulls.map((pull): PrRow => ({ kind: "pull", pull })),
        ];
  const branch: PrRow[] =
    lists.branch === null
      ? [{ kind: "note", text: "Looking for this branch's pull request...", tone: "textMuted" }]
      : typeof lists.branch === "string"
        ? [{ kind: "note", text: `${lists.branch}.`, tone: "textMuted" }]
        : [{ kind: "pull", pull: lists.branch }];
  const none =
    lists.yours !== null &&
    lists.toReview !== null &&
    lists.yours.length === 0 &&
    lists.toReview.length === 0;
  return [
    { kind: "heading", text: "This branch" },
    ...branch,
    ...group("Yours", lists.yours),
    ...group("To review", lists.toReview),
    ...(none
      ? [
          { kind: "note", text: "", tone: "text" } as const,
          {
            kind: "note",
            text: "No other open pull requests are yours or wait on your review.",
            tone: "success",
          } as const,
        ]
      : []),
  ];
}

/** Columns for the ref and reviews, wide enough for every pull request listed. */
export function prColumns(rows: readonly PrRow[]): { ref: number; reviews: number } {
  const pulls = rows.filter((row): row is PullRow => row.kind === "pull").map((row) => row.pull);
  return {
    ref: Math.max(0, ...pulls.map((pull) => Bun.stringWidth(shortRef(pull)))),
    reviews: Math.max(0, ...pulls.map((pull) => reviewBadge(pull).text.length)),
  };
}
