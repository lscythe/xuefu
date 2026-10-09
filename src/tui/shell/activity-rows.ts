import type { ActivityDescription } from "../../application/activity/describe";
import type { ActivityEntry } from "../../application/activity/queries";
import type { Timestamp } from "../../domain/shared/time";
import { wallClock } from "../../domain/shared/wall-clock";
import { truncateToWidth } from "./tab-labels";

export type ActivityRow =
  | { readonly kind: "day"; readonly label: string }
  | {
      readonly kind: "entry";
      readonly time: string;
      /** Padded to the column; null when the list belongs to one workspace. */
      readonly workspace: string | null;
      readonly description: ActivityDescription;
    };

export interface ActivityRowOptions {
  /** Screen rows to fill, and the columns each may take. */
  readonly rows: number;
  readonly width: number;
  readonly now: Timestamp;
  readonly timeZone: string | undefined;
  /** Name each entry's workspace; for a list that spans workspaces. */
  readonly workspaces: boolean;
}

const DAY_MS = 86_400_000;
/** Workspace names beyond this are cut, so the action keeps its room. */
const WORKSPACE_WIDTH = 16;
/** "14:10" and the gap after it. */
const TIME_WIDTH = 7;
/** Narrower than this, a detail or subject says nothing and is left out. */
const MIN_DETAIL = 4;
const MIN_SUBJECT = 2;
const GAP = 2;

/** Cuts the detail first, then the subject, then the action, to fit `width` columns. */
function fit(description: ActivityDescription, width: number): ActivityDescription {
  const { action, subject, detail } = description;
  const said = Bun.stringWidth(action) + (subject === null ? 0 : 1 + Bun.stringWidth(subject.text));
  if (said <= width) {
    const room = width - said - GAP;
    if (detail === null || Bun.stringWidth(detail) <= room) return description;
    return { ...description, detail: room < MIN_DETAIL ? null : truncateToWidth(detail, room) };
  }
  const room = width - Bun.stringWidth(action) - 1;
  if (subject !== null && room >= MIN_SUBJECT) {
    return {
      action,
      subject: { ...subject, text: truncateToWidth(subject.text, room) },
      detail: null,
    };
  }
  return { action: truncateToWidth(action, Math.max(1, width)), subject: null, detail: null };
}

const workspaceOf = (entry: ActivityEntry) =>
  truncateToWidth(entry.workspace?.name ?? entry.workspaceId ?? "-", WORKSPACE_WIDTH);

/** The latest entries that fit, under a heading for each day: Today, Yesterday, then the date. */
export function activityRows(
  entries: readonly ActivityEntry[],
  options: ActivityRowOptions,
): ActivityRow[] {
  const today = wallClock(options.now, options.timeZone).date;
  const yesterday = wallClock((options.now - DAY_MS) as Timestamp, options.timeZone).date;
  const label = (date: string) =>
    date === today ? "Today" : date === yesterday ? "Yesterday" : date;
  const column = options.workspaces
    ? Math.max(...entries.map((entry) => Bun.stringWidth(workspaceOf(entry))))
    : 0;
  const room = options.width - TIME_WIDTH - (options.workspaces ? column + GAP : 0);

  const rows: ActivityRow[] = [];
  let day: string | null = null;
  for (const entry of entries) {
    const clock = wallClock(entry.at, options.timeZone);
    const heading = clock.date !== day;
    // A day heading is only worth a row when an entry fits under it.
    if (rows.length + (heading ? 2 : 1) > options.rows) break;
    if (heading) {
      day = clock.date;
      rows.push({ kind: "day", label: label(day) });
    }
    const name = workspaceOf(entry);
    rows.push({
      kind: "entry",
      time: clock.time,
      workspace: options.workspaces ? name + " ".repeat(column - Bun.stringWidth(name)) : null,
      description: fit(entry.description, room),
    });
  }
  return rows;
}
