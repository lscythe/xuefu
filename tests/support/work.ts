import type { WorkId, WorkspaceId } from "../../src/domain/shared/ids";
import type { Timestamp } from "../../src/domain/shared/time";
import type { IssueKey } from "../../src/domain/work/issue-key";
import { type IssueTitle, startWork, type WorkContext } from "../../src/domain/work/work-context";

/** Work in progress in `workspace`, keyed for the shell's `work` prop. */
export function workIn(
  workspace: string,
  issue: string,
  title: string | null,
  startedAt: number,
): ReadonlyMap<string, WorkContext> {
  const work = startWork(
    {
      id: `wrk-${issue}` as WorkId,
      workspaceId: workspace as WorkspaceId,
      issueKey: issue as IssueKey,
      title: title as IssueTitle | null,
    },
    startedAt as Timestamp,
  );
  return new Map([[workspace, work]]);
}
