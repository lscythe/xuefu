import type { ActivityDescription } from "../../src/application/activity/describe";
import type { ActivityEntry } from "../../src/application/activity/queries";
import type { AppError } from "../../src/application/errors";
import type { WorkspaceId } from "../../src/domain/shared/ids";
import { ok, type Result } from "../../src/domain/shared/result";
import type { Timestamp } from "../../src/domain/shared/time";
import type { Workspace } from "../../src/domain/workspace/workspace";

/** An entry in `workspace` at `at`; "Started work on MOB-1" style descriptions. */
export function activityEntry(
  at: number,
  workspace: Workspace | null,
  action: string,
  subject: ActivityDescription["subject"] = null,
  detail: string | null = null,
): ActivityEntry {
  return {
    seq: at,
    at: at as Timestamp,
    workspaceId: (workspace?.id ?? null) as WorkspaceId | null,
    workspace,
    description: { action, subject, detail },
  };
}

/** In-memory activity for shell tests: newest first, with a way to record more. */
export function fakeActivity(entries: readonly ActivityEntry[] = []) {
  let all = [...entries];
  const listeners = new Set<() => void>();
  const loads: (string | null)[] = [];
  return {
    /** Workspace ids each load asked for, null for every workspace. */
    loads,
    listening: () => listeners.size,
    load: (workspace: Workspace | null): Result<readonly ActivityEntry[], AppError> => {
      loads.push(workspace?.id ?? null);
      return ok(all.filter((e) => workspace === null || e.workspaceId === workspace.id));
    },
    onRecorded: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    record: (entry: ActivityEntry) => {
      all = [entry, ...all];
      for (const listener of listeners) listener();
    },
  };
}
