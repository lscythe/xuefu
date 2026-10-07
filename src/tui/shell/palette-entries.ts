import type { AppError } from "../../application/errors";
import type { TimerView } from "../../application/timesheet/queries";
import { ok, type Result } from "../../domain/shared/result";
import { timerToggle } from "../../domain/timesheet/timer";
import { issueKey } from "../../domain/work/issue-key";
import { issueTitle, type WorkContext } from "../../domain/work/work-context";
import type { Workspace } from "../../domain/workspace/workspace";
import type { PaletteEntry } from "../palette/palette-model";

/** What the cockpit shows right now; decides which entries apply. */
export interface CockpitState {
  readonly workspace: Workspace | null;
  readonly work: WorkContext | null;
  readonly timer: TimerView | null;
}

/** What palette entries do; each resolves once done, with any error to show. */
export interface CockpitActions {
  readonly startWork: (issue: string, title: string | null) => Promise<Result<unknown, AppError>>;
  readonly finishWork: () => Promise<Result<unknown, AppError>>;
  readonly toggleTimer: () => Promise<Result<unknown, AppError>>;
  readonly stopTimer: () => Promise<Result<unknown, AppError>>;
  readonly openSwitcher: () => void;
  readonly closeTab: () => Promise<Result<unknown, AppError>>;
  readonly quit: () => void;
}

const done = (act: () => void) => (): Promise<Result<unknown, AppError>> => {
  act();
  return Promise.resolve(ok(undefined));
};

const TOGGLE_TITLES = { start: "Start timer", pause: "Pause timer", resume: "Resume timer" };

/** The palette's entries for the cockpit as it is, most specific to the workspace first. */
export function paletteEntries(state: CockpitState, actions: CockpitActions): PaletteEntry[] {
  const entries: PaletteEntry[] = [];
  if (state.workspace !== null) {
    entries.push({
      title: state.work === null ? "Start work" : "Start other work",
      keys: null,
      fields: [
        { label: "Issue key", example: "MOB-2841", optional: false, check: issueKey },
        { label: "Title", example: "Add biometric login", optional: true, check: issueTitle },
      ],
      run: ([issue, title]) => actions.startWork(issue ?? "", title ?? null),
    });
  }
  if (state.work !== null) {
    entries.push({
      title: `Finish work on ${state.work.issueKey}`,
      keys: null,
      fields: [],
      run: actions.finishWork,
    });
  }
  const toggle = timerToggle(state.timer?.timer ?? null, state.workspace?.id ?? null);
  if (toggle !== null) {
    entries.push({ title: TOGGLE_TITLES[toggle], keys: "t", fields: [], run: actions.toggleTimer });
  }
  if (state.timer !== null) {
    entries.push({ title: "Stop timer", keys: "T", fields: [], run: actions.stopTimer });
  }
  entries.push({
    title: "Switch workspace",
    keys: "^W",
    fields: [],
    run: done(actions.openSwitcher),
  });
  if (state.workspace !== null) {
    entries.push({ title: "Close tab", keys: "alt+w", fields: [], run: actions.closeTab });
  }
  entries.push({ title: "Quit", keys: "q", fields: [], run: done(actions.quit) });
  return entries;
}
