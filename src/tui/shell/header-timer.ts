import type { TimerView } from "../../application/timesheet/queries";
import { clockDuration, type Timestamp } from "../../domain/shared/time";
import { elapsed } from "../../domain/timesheet/timer";
import { truncateToWidth } from "./tab-labels";

export interface HeaderTimer {
  /** "Timer" or "Paused" for the workspace in front, else whose timer it is. */
  readonly label: string;
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
  const paused = timer.status === "paused";
  const here = front === null || front === timer.workspaceId;
  const name = truncateToWidth(workspace?.name ?? timer.workspaceId, NAME_WIDTH);
  return {
    label: here ? (paused ? "Paused" : "Timer") : paused ? `${name} paused` : name,
    clock: clockDuration(elapsed(timer, now)),
    paused,
  };
}
