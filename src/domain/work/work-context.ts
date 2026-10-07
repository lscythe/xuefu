import type { Brand } from "../shared/brand";
import {
  type ConflictError,
  conflict,
  type ValidationError,
  validationError,
} from "../shared/errors";
import type { WorkId, WorkspaceId } from "../shared/ids";
import { err, ok, type Result } from "../shared/result";
import type { Timestamp } from "../shared/time";
import type { IssueKey } from "./issue-key";

/** A short human description of the issue, e.g. its tracker summary. */
export type IssueTitle = Brand<string, "IssueTitle">;

const MAX_TITLE = 200;
const CONTROL_CHARACTER = /\p{Cc}/u;

export function issueTitle(raw: string): Result<IssueTitle, ValidationError> {
  const value = raw.trim();
  const problem =
    value.length === 0
      ? "must not be empty"
      : value.length > MAX_TITLE
        ? `must be at most ${MAX_TITLE} characters`
        : CONTROL_CHARACTER.test(value)
          ? "must not contain control characters"
          : null;
  if (problem !== null) {
    return err(validationError("Issue title is invalid", [{ path: "title", message: problem }]));
  }
  return ok(value as IssueTitle);
}

/**
 * What a workspace is being worked on: one issue at a time, open until finished. Finished
 * contexts are kept as history.
 */
export interface WorkContext {
  readonly id: WorkId;
  readonly workspaceId: WorkspaceId;
  readonly issueKey: IssueKey;
  readonly title: IssueTitle | null;
  readonly startedAt: Timestamp;
  /** Null while the work is in progress. */
  readonly endedAt: Timestamp | null;
}

export interface NewWork {
  readonly id: WorkId;
  readonly workspaceId: WorkspaceId;
  readonly issueKey: IssueKey;
  readonly title: IssueTitle | null;
}

export function startWork(fields: NewWork, at: Timestamp): WorkContext {
  return Object.freeze({ ...fields, startedAt: at, endedAt: null });
}

/** Ends the work; a clock that moved backwards ends it when it started, never before. */
export function finishWork(work: WorkContext, at: Timestamp): Result<WorkContext, ConflictError> {
  if (work.endedAt !== null) {
    return err(conflict(`Work on ${work.issueKey} has already finished`, "work", work.id));
  }
  return ok(Object.freeze({ ...work, endedAt: at < work.startedAt ? work.startedAt : at }));
}

/** Gives open work a new title, or keeps the old one when none is given. */
export function retitleWork(work: WorkContext, title: IssueTitle | null): WorkContext {
  return title === null || title === work.title ? work : Object.freeze({ ...work, title });
}
