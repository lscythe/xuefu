import type { TimerView } from "../../application/timesheet/queries";
import { clockDuration, type Timestamp } from "../../domain/shared/time";
import { elapsed } from "../../domain/timesheet/timer";
import { truncateToWidth } from "./tab-labels";

export interface HeaderTimer {
  /** Whose timer it is when it runs for a workspace other than the one in front, else null. */
  readonly owner: string | null;
  readonly clock: string;
  readonly paused: boolean;
}

/** Longest workspace name shown for a timer running somewhere else. */
const NAME_WIDTH = 16;

export function headerTimer(
  view: TimerView | null,
  front: string | null,
  now: Timestamp,
): HeaderTimer | null {
  if (view === null) return null;
  const { timer, workspace } = view;
  const here = front === null || front === timer.workspaceId;
  return {
    owner: here ? null : truncateToWidth(workspace?.name ?? timer.workspaceId, NAME_WIDTH),
    clock: clockDuration(elapsed(timer, now)),
    paused: timer.status === "paused",
  };
}

/** The timer as the header writes it: "● 01:42:18", "Auth Service ● 00:12:00", "paused" after. */
export function headerTimerText(timer: HeaderTimer, ascii: boolean): string {
  const owner = timer.owner === null ? "" : `${timer.owner} `;
  return `${owner}${ascii ? "*" : "●"} ${timer.clock}${timer.paused ? " paused" : ""}`;
}
