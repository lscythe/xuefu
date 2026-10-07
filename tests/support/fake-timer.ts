import type { AppError } from "../../src/application/errors";
import type { Clock } from "../../src/application/ports/clock";
import type { TimerView } from "../../src/application/timesheet/queries";
import { notFound } from "../../src/domain/shared/errors";
import type { TimerId } from "../../src/domain/shared/ids";
import { err, ok, type Result } from "../../src/domain/shared/result";
import {
  pauseTimer,
  resumeTimer,
  startTimer,
  stopTimer,
  type Timer,
  timerToggle,
} from "../../src/domain/timesheet/timer";
import type { IssueKey } from "../../src/domain/work/issue-key";
import type { Workspace } from "../../src/domain/workspace/workspace";

function unwrap<T>(result: Result<T, unknown>): T {
  if (!result.ok) throw new Error("timer transition failed");
  return result.value;
}

/** An in-memory timer that follows the real domain rules, for driving the shell in tests. */
export function fakeTimer(clock: Clock, workspaces: readonly Workspace[]) {
  let active: Timer | null = null;
  let created = 0;
  const view = (timer: Timer): TimerView => ({
    timer,
    workspace: workspaces.find((w) => w.id === timer.workspaceId) ?? null,
  });

  return {
    current: (): TimerView | null => (active === null ? null : view(active)),
    toggle: (
      front: Workspace | null,
      issue: IssueKey | null = null,
    ): Promise<Result<TimerView | null, AppError>> => {
      const now = clock.now();
      const action = timerToggle(active, front?.id ?? null);
      if (action === "pause" && active !== null) active = unwrap(pauseTimer(active, now));
      else if (action === "resume" && active !== null) active = unwrap(resumeTimer(active, now));
      else if (action === "start" && front !== null) {
        created += 1;
        active = startTimer(
          { id: `tmr-${created}` as TimerId, workspaceId: front.id, issueKey: issue },
          now,
        );
      }
      return Promise.resolve(ok(action === null || active === null ? null : view(active)));
    },
    stop: (): Promise<Result<TimerView, AppError>> => {
      if (active === null) {
        return Promise.resolve(
          err({ ...notFound("timer", "active"), message: "No timer is running" }),
        );
      }
      const stopped = unwrap(stopTimer(active, clock.now()));
      active = null;
      return Promise.resolve(ok(view(stopped)));
    },
  };
}
