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

/** What the note keys do, set into the Notes panel's frame. */
export function noteKeys(work: WorkContext | null, ascii: boolean): string {
  return work === null ? "e edit" : `e edit${ascii ? " | " : " · "}i edit ${work.issueKey}`;
}

/** A word on the state of the section in front, set into the right of its frame. */
export function sectionStatus(
  id: string | undefined,
  state: {
    readonly work: WorkContext | null;
    readonly timer: TimerView | null;
    readonly workspace: Workspace | null;
    /** The day's tracked total, already written out. */
    readonly today: string | null;
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
    case "timesheet":
      return state.today;
    default:
      return null;
  }
}

/** Keys for a panel's frame, in order, with what does not apply left out. */
export function panelKeys(parts: readonly (string | null)[], ascii: boolean): string | null {
  const shown = parts.filter((part): part is string => part !== null);
  return shown.length === 0 ? null : shown.join(ascii ? " | " : " · ");
}

/** A key for a section's frame, with how much it is worth keeping when space is short. */
export interface PanelHint {
  readonly text: string;
  /** Lower is kept longer. */
  readonly rank: number;
}

/** The hints that fit in `width` columns, giving up the least needed first. */
export function fitHints(
  hints: readonly PanelHint[],
  width: number,
  ascii: boolean,
): string | null {
  const and = ascii ? " | " : " · ";
  const length = (shown: readonly PanelHint[]) =>
    shown.reduce((sum, hint) => sum + Bun.stringWidth(hint.text), 0) +
    Math.max(0, shown.length - 1) * and.length;
  let shown = [...hints];
  while (shown.length > 0 && length(shown) > width) {
    const least = Math.max(...shown.map((hint) => hint.rank));
    shown = shown.filter((hint) => hint.rank !== least);
  }
  return panelKeys(
    shown.map((hint) => hint.text),
    ascii,
  );
}
