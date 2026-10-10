import type { TimerView } from "../../application/timesheet/queries";
import { assertNever } from "../../domain/shared/assert-never";
import type { TimerToggle } from "../../domain/timesheet/timer";
import type { WorkContext } from "../../domain/work/work-context";
import type { Workspace } from "../../domain/workspace/workspace";

/** What the timer key does, set into the Work panel's frame. */
export function timerKeys(toggle: TimerToggle | null, ascii: boolean): string | null {
  const and = ascii ? " | " : " · ";
  switch (toggle) {
    case null:
      return null;
    case "start":
      return "t start timer";
    case "pause":
      return `t pause${and}T stop`;
    case "resume":
      return `t resume${and}T stop`;
    default:
      return assertNever(toggle);
  }
}

/** A word on the state of the section in front, set into the right of its frame. */
export function sectionStatus(
  id: string | undefined,
  state: {
    readonly work: WorkContext | null;
    readonly timer: TimerView | null;
    readonly workspace: Workspace | null;
  },
): string | null {
  switch (id) {
    case "work": {
      const active = state.timer?.timer;
      const timing =
        active !== undefined &&
        state.work !== null &&
        active.workspaceId === state.work.workspaceId &&
        active.issueKey === state.work.issueKey;
      return timing ? (active.status === "paused" ? "paused" : "running") : null;
    }
    case "notes":
      return state.work?.issueKey ?? null;
    case "activity":
      return state.workspace === null ? "everywhere" : null;
    default:
      return null;
  }
}

/** Keys for a panel's frame, in order, with what does not apply left out. */
export function panelKeys(parts: readonly (string | null)[], ascii: boolean): string | null {
  const shown = parts.filter((part): part is string => part !== null);
  return shown.length === 0 ? null : shown.join(ascii ? " | " : " · ");
}
