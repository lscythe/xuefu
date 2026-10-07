import type { Brand } from "./brand";
import { type ValidationError, validationError } from "./errors";
import { err, ok, type Result } from "./result";

export type EventId = Brand<string, "EventId">;
export type CorrelationId = Brand<string, "CorrelationId">;
/** Slug identifying a workspace; safe to use as a file-name segment. */
export type WorkspaceId = Brand<string, "WorkspaceId">;
export type TimerId = Brand<string, "TimerId">;

const TOKEN_ID = /^[A-Za-z0-9_-]{1,128}$/;
const WORKSPACE_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;

function parseId<T extends string>(
  label: string,
  pattern: RegExp,
  rule: string,
  raw: string,
): Result<Brand<string, T>, ValidationError> {
  if (!pattern.test(raw)) {
    return err(validationError(`${label} is invalid`, [{ path: label, message: rule }], { raw }));
  }
  return ok(raw as Brand<string, T>);
}

export function eventId(raw: string): Result<EventId, ValidationError> {
  return parseId("EventId", TOKEN_ID, "1-128 characters from [A-Za-z0-9_-]", raw);
}

export function correlationId(raw: string): Result<CorrelationId, ValidationError> {
  return parseId("CorrelationId", TOKEN_ID, "1-128 characters from [A-Za-z0-9_-]", raw);
}

export function timerId(raw: string): Result<TimerId, ValidationError> {
  return parseId("TimerId", TOKEN_ID, "1-128 characters from [A-Za-z0-9_-]", raw);
}

export function workspaceId(raw: string): Result<WorkspaceId, ValidationError> {
  return parseId(
    "Workspace id",
    WORKSPACE_ID,
    "lowercase letters, digits and '-', starting with a letter or digit, at most 64 characters",
    raw,
  );
}
