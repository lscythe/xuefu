import type { CommandBus } from "../../../application/commands/command-bus";
import type { AppError } from "../../../application/errors";
import type { StartedWork, WorkCommands } from "../../../application/work/commands";
import { ok, type Result } from "../../../domain/shared/result";
import { type JiraIssue, startTransition, workTitle } from "../domain/issue";
import type { JiraActions } from "./actions";
import type { JiraClient } from "./jira-client";

/** A move to offer once work has started, as jira.issue.move takes it. */
interface StartMove {
  readonly key: string;
  readonly transition: string;
  readonly from: string;
  readonly to: string;
}

export interface WorkOnIssue {
  readonly issue: JiraIssue;
  readonly started: StartedWork;
  /** Null when the issue is already under way, or its workflow has no move to start it. */
  readonly move: StartMove | null;
  /** Why the moves could not be read; the work has started all the same. */
  readonly unread: AppError | null;
}

interface StartWorkDependencies {
  readonly client: JiraClient;
  /** The core's work.start. */
  readonly startWork: WorkCommands["start"];
  readonly invoke: CommandBus["invoke"];
}

/** What the plugin changes: work in XueFu, and issues in Jira. */
export interface JiraChanges extends StartWorkDependencies {
  readonly actions: JiraActions;
}

/**
 * Starts work on an issue in a workspace, titled with its summary, which also times it. When the
 * issue is still to do, finds the move that starts it in Jira, to offer: moving it changes Jira,
 * so it is asked for, never made here.
 */
export async function startWorkOnIssue(
  deps: StartWorkDependencies,
  workspace: string,
  key: string,
  signal?: AbortSignal,
): Promise<Result<WorkOnIssue, AppError>> {
  const read = await deps.client.issue(key, signal);
  if (!read.ok) return read;
  const issue = read.value;
  const started = await deps.invoke(
    deps.startWork,
    { workspace, issue: issue.key, title: workTitle(issue.summary) },
    signal === undefined ? {} : { signal },
  );
  if (!started.ok) return started;
  if (issue.status.category !== "todo") {
    return ok({ issue, started: started.value, move: null, unread: null });
  }
  const moves = await deps.client.transitions(issue.key, signal);
  if (!moves.ok) return ok({ issue, started: started.value, move: null, unread: moves.error });
  const transition = startTransition(moves.value);
  return ok({
    issue,
    started: started.value,
    move:
      transition === null
        ? null
        : {
            key: issue.key,
            transition: transition.id,
            from: issue.status.name,
            to: transition.to.name,
          },
    unread: null,
  });
}
