import type { z } from "zod";
import type { ConfirmationPrompt } from "../../domain/shared/confirmation";
import type { ConfirmationRequiredError } from "../../domain/shared/errors";
import type { CorrelationId } from "../../domain/shared/ids";
import type { Result } from "../../domain/shared/result";
import type { AppError } from "../errors";
import type { Clock } from "../ports/clock";
import type { Logger } from "../ports/logger";

export type CommandSafety = "safe" | "confirm" | "destructive";

export interface CommandContext {
  readonly correlationId: CorrelationId;
  /** Already bound to the correlation id and command name. */
  readonly logger: Logger;
  /** Aborted on cancellation or timeout; long-running handlers must observe it. */
  readonly signal: AbortSignal;
  readonly clock: Clock;
}

interface CommandBase<I, O> {
  /** Stable dotted id, e.g. `git.push.force`; persisted in command history. */
  readonly name: string;
  readonly title: string;
  readonly category: string;
  readonly input: z.ZodType<I>;
  readonly timeoutMs?: number;
  // Method syntax keeps definitions with specific input types assignable to the registry type.
  handler(input: I, context: CommandContext): Promise<Result<O, AppError>>;
}

interface SafeCommand<I, O> extends CommandBase<I, O> {
  readonly safety: "safe";
}

interface GuardedCommand<I, O> extends CommandBase<I, O> {
  readonly safety: "confirm" | "destructive";
  /** Exactly what will happen, shown to the user before they approve. */
  describe(input: I): ConfirmationPrompt;
}

export type CommandDefinition<I, O> = SafeCommand<I, O> | GuardedCommand<I, O>;

export type AnyCommand = CommandDefinition<unknown, unknown>;

/** Identity helper that lets TypeScript infer input/output types from the schema and handler. */
export function defineCommand<I, O>(definition: CommandDefinition<I, O>): CommandDefinition<I, O> {
  return Object.freeze(definition);
}

/** Approval bound to one command and one exact validated input. */
export interface ConfirmationToken {
  readonly command: string;
  readonly inputDigest: string;
}

export function confirmationTokenFor(error: ConfirmationRequiredError): ConfirmationToken {
  return { command: error.command, inputDigest: error.inputDigest };
}
