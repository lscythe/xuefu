import type { AppError } from "../../src/application/errors";
import type { Clock } from "../../src/application/ports/clock";
import type { FinishedWork, StartedWork } from "../../src/application/work/commands";
import { notFound } from "../../src/domain/shared/errors";
import type { WorkId } from "../../src/domain/shared/ids";
import { err, ok, type Result } from "../../src/domain/shared/result";
import { issueKey } from "../../src/domain/work/issue-key";
import {
  finishWork,
  type IssueTitle,
  startWork,
  type WorkContext,
} from "../../src/domain/work/work-context";
import type { Workspace } from "../../src/domain/workspace/workspace";
import type { fakeTimer } from "./fake-timer";

/** In-memory work that follows the domain rules and drives a fake timer, for shell tests. */
export function fakeWork(clock: Clock, timer: ReturnType<typeof fakeTimer>) {
  const open = new Map<string, WorkContext>();
  let created = 0;
  return {
    open: (): ReadonlyMap<string, WorkContext> => open,
    start: async (
      workspace: Workspace,
      issue: string,
      title: string | null,
    ): Promise<Result<StartedWork, AppError>> => {
      const key = issueKey(issue);
      if (!key.ok) return key;
      const previous = open.get(workspace.id) ?? null;
      const ended = previous === null ? null : finishWork(previous, clock.now());
      created += 1;
      const work = startWork(
        {
          id: `wrk-${created}` as WorkId,
          workspaceId: workspace.id,
          issueKey: key.value,
          title: title as IssueTitle | null,
        },
        clock.now(),
      );
      open.set(workspace.id, work);
      const stopped = timer.current();
      if (stopped !== null) await timer.stop();
      const timed = await timer.toggle(workspace, key.value);
      const started = timed.ok ? timed.value : null;
      return ok({
        work: { work, workspace },
        finished: ended?.ok === true ? ended.value : null,
        timer: started === null ? null : { timer: started, replaced: stopped },
      });
    },
    finish: async (workspace: Workspace): Promise<Result<FinishedWork, AppError>> => {
      const work = open.get(workspace.id);
      if (work === undefined) {
        return err({ ...notFound("work", workspace.id), message: "No work in progress" });
      }
      open.delete(workspace.id);
      const ended = finishWork(work, clock.now());
      const stopped = await timer.stop();
      return ok({
        work: { work: ended.ok ? ended.value : work, workspace },
        timer: stopped.ok ? stopped.value : null,
      });
    },
  };
}
