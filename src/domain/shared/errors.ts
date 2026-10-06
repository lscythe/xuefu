import type { ConfirmationPrompt } from "./confirmation";

/** Scalar-only so contexts serialise safely and can be redacted value by value. */
export type ErrorContext = Readonly<Record<string, string | number | boolean | null>>;

/** Summary of a foreign exception; the original object may hold secrets (e.g. request headers). */
export interface CauseSummary {
  readonly name: string;
  readonly message: string;
}

interface ErrorShape<K extends string> {
  readonly kind: K;
  readonly message: string;
  readonly context: ErrorContext;
  /** Actionable next step for the user, e.g. "Run: xuefu doctor jira". */
  readonly hint?: string;
  readonly cause?: CauseSummary;
}

export interface ValidationIssue {
  readonly path: string;
  readonly message: string;
}

export interface ValidationError extends ErrorShape<"validation"> {
  readonly issues: readonly ValidationIssue[];
}

export interface ConfigurationIssue extends ValidationIssue {
  readonly line?: number;
  readonly column?: number;
}

export interface ConfigurationError extends ErrorShape<"configuration"> {
  /** File path, "environment" or "cli". */
  readonly source: string;
  readonly issues: readonly ConfigurationIssue[];
}

export interface StorageError extends ErrorShape<"storage"> {
  readonly operation: string;
}

export type MigrationFailureReason =
  | "failed"
  | "checksum-mismatch"
  | "database-newer"
  | "invalid-plan"
  | "backup-failed";

export interface MigrationError extends ErrorShape<"migration"> {
  readonly version: number;
  readonly reason: MigrationFailureReason;
}

export interface FileSystemError extends ErrorShape<"filesystem"> {
  readonly path: string;
  readonly operation: string;
}

export interface CommandNotFoundError extends ErrorShape<"command-not-found"> {
  readonly command: string;
}

export interface DuplicateCommandError extends ErrorShape<"duplicate-command"> {
  readonly command: string;
}

export interface ConfirmationRequiredError extends ErrorShape<"confirmation-required"> {
  readonly command: string;
  readonly prompt: ConfirmationPrompt;
  /** Digest of the validated input the confirmation must be bound to. */
  readonly inputDigest: string;
}

export type CancelledError = ErrorShape<"cancelled">;

export interface TimeoutError extends ErrorShape<"timeout"> {
  readonly afterMs: number;
}

export type UnexpectedError = ErrorShape<"unexpected">;

export type CoreError =
  | ValidationError
  | ConfigurationError
  | StorageError
  | MigrationError
  | FileSystemError
  | CommandNotFoundError
  | DuplicateCommandError
  | ConfirmationRequiredError
  | CancelledError
  | TimeoutError
  | UnexpectedError;

export interface ErrorOptions {
  readonly context?: ErrorContext;
  readonly hint?: string;
  readonly cause?: unknown;
}

function base<K extends string>(kind: K, message: string, options: ErrorOptions): ErrorShape<K> {
  return {
    kind,
    message,
    context: options.context ?? {},
    ...(options.hint === undefined ? {} : { hint: options.hint }),
    ...(options.cause === undefined ? {} : { cause: describeCause(options.cause) }),
  };
}

export function describeCause(thrown: unknown): CauseSummary {
  if (thrown instanceof Error) return { name: thrown.name, message: thrown.message };
  if (typeof thrown === "object" && thrown !== null)
    return { name: "NonError", message: "[object]" };
  return { name: "NonError", message: String(thrown) };
}

export function validationError(
  message: string,
  issues: readonly ValidationIssue[],
  context: ErrorContext = {},
): ValidationError {
  return Object.freeze({ ...base("validation", message, { context }), issues });
}

export function configurationError(
  message: string,
  source: string,
  issues: readonly ConfigurationIssue[],
  options: ErrorOptions = {},
): ConfigurationError {
  return Object.freeze({ ...base("configuration", message, options), source, issues });
}

export function storageError(
  message: string,
  operation: string,
  options: ErrorOptions = {},
): StorageError {
  return Object.freeze({ ...base("storage", message, options), operation });
}

export function migrationError(
  message: string,
  version: number,
  reason: MigrationFailureReason,
  options: ErrorOptions = {},
): MigrationError {
  return Object.freeze({ ...base("migration", message, options), version, reason });
}

export function fileSystemError(
  message: string,
  path: string,
  operation: string,
  options: ErrorOptions = {},
): FileSystemError {
  return Object.freeze({ ...base("filesystem", message, options), path, operation });
}

export function commandNotFound(command: string): CommandNotFoundError {
  return Object.freeze({
    ...base("command-not-found", `Unknown command: ${command}`, { context: { command } }),
    command,
  });
}

export function duplicateCommand(command: string): DuplicateCommandError {
  return Object.freeze({
    ...base("duplicate-command", `Command already registered: ${command}`, {
      context: { command },
    }),
    command,
  });
}

export function confirmationRequired(
  command: string,
  prompt: ConfirmationPrompt,
  inputDigest: string,
): ConfirmationRequiredError {
  return Object.freeze({
    ...base("confirmation-required", `${prompt.title} requires confirmation`, {
      context: { command },
    }),
    command,
    prompt,
    inputDigest,
  });
}

export function cancelled(message: string, options: ErrorOptions = {}): CancelledError {
  return Object.freeze(base("cancelled", message, options));
}

export function timeout(
  message: string,
  afterMs: number,
  options: ErrorOptions = {},
): TimeoutError {
  return Object.freeze({ ...base("timeout", message, options), afterMs });
}

export function unexpected(
  message: string,
  thrown: unknown,
  options: Omit<ErrorOptions, "cause"> = {},
): UnexpectedError {
  return Object.freeze(base("unexpected", message, { ...options, cause: thrown }));
}
