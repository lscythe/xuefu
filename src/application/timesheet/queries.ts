import type { StorageError } from "../../domain/shared/errors";
import { ok, type Result } from "../../domain/shared/result";
import type { Timer } from "../../domain/timesheet/timer";
import type { WorkspaceRegistry } from "../../domain/workspace/registry";
import type { Workspace } from "../../domain/workspace/workspace";
import type { TimerRepository } from "../ports/timer-repository";
import type { WorkspaceRepository } from "../ports/workspace-repository";

/** A timer with the workspace it tracks; null once that workspace has been removed. */
export interface TimerView {
  readonly timer: Timer;
  readonly workspace: Workspace | null;
}

export function viewTimer(registry: WorkspaceRegistry, timer: Timer): TimerView {
  return {
    timer,
    workspace: registry.workspaces.find((w) => w.id === timer.workspaceId) ?? null,
  };
}

export class TimerQueries {
  constructor(
    private readonly timers: TimerRepository,
    private readonly workspaces: WorkspaceRepository,
  ) {}

  /** The running or paused timer, if there is one. */
  active(): Result<TimerView | null, StorageError> {
    const active = this.timers.active();
    if (!active.ok) return active;
    if (active.value === null) return ok(null);
    const loaded = this.workspaces.load();
    return loaded.ok ? ok(viewTimer(loaded.value, active.value)) : loaded;
  }
}
