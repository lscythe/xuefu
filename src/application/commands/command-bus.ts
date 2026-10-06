import {
  cancelled,
  commandNotFound,
  confirmationRequired,
  type DuplicateCommandError,
  duplicateCommand,
  timeout,
  unexpected,
  type ValidationError,
  validationError,
} from "../../domain/shared/errors";
import type { CorrelationId } from "../../domain/shared/ids";
import { err, ok, type Result } from "../../domain/shared/result";
import { stableStringify } from "../../domain/shared/stable-json";
import type { AppError } from "../errors";
import type { Clock } from "../ports/clock";
import type { IdGenerator } from "../ports/id-generator";
import type { Logger } from "../ports/logger";
import type {
  AnyCommand,
  CommandContext,
  CommandDefinition,
  CommandSafety,
  ConfirmationToken,
} from "./command";

export interface CommandBusDependencies {
  readonly logger: Logger;
  readonly clock: Clock;
  readonly ids: IdGenerator;
}

export interface DispatchOptions {
  readonly confirmation?: ConfirmationToken;
  readonly signal?: AbortSignal;
  /** Continue an existing flow's correlation id instead of starting a new one. */
  readonly correlationId?: CorrelationId;
}

export interface CommandSummary {
  readonly name: string;
  readonly title: string;
  readonly category: string;
  readonly safety: CommandSafety;
}

const COMMAND_NAME = /^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)+$/;

/**
 * The only way to execute a user intent. Every entry point (palette, keybinding, screen, CLI,
 * automation) goes through dispatch, so validation, confirmation and logging cannot be bypassed.
 */
export class CommandBus {
  readonly #commands = new Map<string, AnyCommand>();

  constructor(private readonly deps: CommandBusDependencies) {}

  register<I, O>(
    command: CommandDefinition<I, O>,
  ): Result<void, DuplicateCommandError | ValidationError> {
    if (!COMMAND_NAME.test(command.name)) {
      return err(
        validationError(`Invalid command name: ${command.name}`, [
          { path: "name", message: "dotted lowercase segments, e.g. git.branch.create" },
        ]),
      );
    }
    if (this.#commands.has(command.name)) return err(duplicateCommand(command.name));
    this.#commands.set(command.name, command as AnyCommand);
    return ok(undefined);
  }

  list(): CommandSummary[] {
    return [...this.#commands.values()]
      .map(({ name, title, category, safety }) => ({ name, title, category, safety }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async dispatch(
    name: string,
    rawInput: unknown,
    options: DispatchOptions = {},
  ): Promise<Result<unknown, AppError>> {
    const correlationId = options.correlationId ?? this.deps.ids.correlationId();
    const logger = this.deps.logger.child({ correlationId, command: name });

    const command = this.#commands.get(name);
    if (command === undefined) {
      logger.warn("Unknown command");
      return err(commandNotFound(name));
    }

    const parsed = command.input.safeParse(rawInput);
    if (!parsed.success) {
      const issues = parsed.error.issues.map((i) => ({
        path: i.path.map(String).join("."),
        message: i.message,
      }));
      // Paths only: input values may contain secrets or personal data.
      logger.warn("Command input rejected", { issues: issues.map((i) => i.path) });
      return err(validationError(`Invalid input for ${name}`, issues, { command: name }));
    }
    const input = parsed.data;

    if (command.safety !== "safe") {
      const inputDigest = stableStringify(input);
      const token = options.confirmation;
      if (token === undefined || token.command !== name || token.inputDigest !== inputDigest) {
        logger.info("Confirmation required", { safety: command.safety });
        return err(confirmationRequired(name, command.describe(input), inputDigest));
      }
    }

    if (options.signal?.aborted === true) {
      logger.info("Command cancelled before start");
      return err(cancelled(`${command.title} was cancelled`));
    }

    const started = this.deps.clock.now();
    logger.info("Command started", { safety: command.safety });
    const result = await this.execute(command, input, logger, correlationId, options.signal);
    const durationMs = this.deps.clock.now() - started;

    if (result.ok) {
      logger.info("Command succeeded", { durationMs });
    } else if (result.error.kind === "unexpected") {
      logger.error("Command failed unexpectedly", { durationMs, error: result.error });
    } else {
      logger.warn("Command failed", { durationMs, errorKind: result.error.kind });
    }
    return result;
  }

  /**
   * Typed `dispatch` for callers holding the definition. Only the exact registered definition is
   * accepted, which is what makes narrowing the output to `O` sound.
   */
  async invoke<I, O>(
    command: CommandDefinition<I, O>,
    rawInput: unknown,
    options: DispatchOptions = {},
  ): Promise<Result<O, AppError>> {
    if (this.#commands.get(command.name) !== (command as AnyCommand)) {
      return err(commandNotFound(command.name));
    }
    return (await this.dispatch(command.name, rawInput, options)) as Result<O, AppError>;
  }

  private execute(
    command: AnyCommand,
    input: unknown,
    logger: Logger,
    correlationId: CorrelationId,
    external: AbortSignal | undefined,
  ): Promise<Result<unknown, AppError>> {
    const controller = new AbortController();
    const context: CommandContext = {
      correlationId,
      logger,
      signal: controller.signal,
      clock: this.deps.clock,
    };

    return new Promise((resolve) => {
      let settled = false;
      let timer: ReturnType<typeof setTimeout> | undefined;

      const finish = (result: Result<unknown, AppError>) => {
        if (settled) return;
        settled = true;
        if (timer !== undefined) clearTimeout(timer);
        external?.removeEventListener("abort", onAbort);
        resolve(result);
      };
      const onAbort = () => {
        controller.abort();
        finish(err(cancelled(`${command.title} was cancelled`)));
      };

      external?.addEventListener("abort", onAbort, { once: true });
      if (command.timeoutMs !== undefined) {
        const afterMs = command.timeoutMs;
        timer = setTimeout(() => {
          controller.abort();
          finish(err(timeout(`${command.title} timed out`, afterMs)));
        }, afterMs);
      }

      void Promise.resolve()
        .then(() => command.handler(input, context))
        .then(
          (result) => {
            if (settled) logger.debug("Ignoring result that arrived after cancellation");
            finish(result);
          },
          (thrown: unknown) => {
            const error = unexpected(`${command.title} failed unexpectedly`, thrown);
            if (settled) logger.error("Handler failed after cancellation", { error });
            finish(err(error));
          },
        );
    });
  }
}
