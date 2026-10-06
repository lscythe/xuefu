import { parseArgs as parseNodeArgs } from "node:util";
import { type ValidationError, validationError } from "../domain/shared/errors";
import { err, ok, type Result } from "../domain/shared/result";

/** A command that needs the application started. Paths are raw; bootstrap resolves them. */
export type CliCommand =
  | { readonly kind: "diagnostics"; readonly json: boolean }
  | { readonly kind: "workspace.list"; readonly json: boolean }
  | {
      readonly kind: "workspace.add";
      /** null means the current directory. */
      readonly path: string | null;
      readonly name: string | null;
      readonly id: string | null;
      readonly group: string | null;
    }
  | { readonly kind: "workspace.remove"; readonly id: string; readonly yes: boolean }
  | { readonly kind: "workspace.group"; readonly id: string; readonly group: string | null }
  | { readonly kind: "workspace.which"; readonly path: string | null; readonly json: boolean };

export type CliInvocation =
  | { readonly kind: "help" }
  | { readonly kind: "version" }
  | {
      readonly kind: "run";
      readonly command: CliCommand;
      /** Raw config overrides; validated by the configuration layer like any other source. */
      readonly overrides: Readonly<Record<string, unknown>>;
    };

type Values = Readonly<Record<string, string | boolean | (string | boolean)[] | undefined>>;

interface CommandSpec {
  /** Positional arguments as shown in usage errors, e.g. "<id> <group>". */
  readonly usage: string;
  readonly minArgs: number;
  readonly maxArgs: number;
  readonly flags: readonly string[];
  build(args: readonly string[], values: Values): CliCommand;
}

const GLOBAL_FLAGS = new Set(["help", "version", "debug", "log-level"]);

const text = (values: Values, key: string): string | null => {
  const value = values[key];
  return typeof value === "string" ? value : null;
};
const flag = (values: Values, key: string): boolean => values[key] === true;
const arg = (args: readonly string[], index: number): string => args[index] ?? "";

const COMMANDS: Readonly<Record<string, CommandSpec>> = {
  diagnostics: {
    usage: "",
    minArgs: 0,
    maxArgs: 0,
    flags: ["json"],
    build: (_args, values) => ({ kind: "diagnostics", json: flag(values, "json") }),
  },
  "workspace list": {
    usage: "",
    minArgs: 0,
    maxArgs: 0,
    flags: ["json"],
    build: (_args, values) => ({ kind: "workspace.list", json: flag(values, "json") }),
  },
  "workspace add": {
    usage: "[path]",
    minArgs: 0,
    maxArgs: 1,
    flags: ["name", "id", "group"],
    build: (args, values) => ({
      kind: "workspace.add",
      path: args[0] ?? null,
      name: text(values, "name"),
      id: text(values, "id"),
      group: text(values, "group"),
    }),
  },
  "workspace remove": {
    usage: "<id>",
    minArgs: 1,
    maxArgs: 1,
    flags: ["yes"],
    build: (args, values) => ({
      kind: "workspace.remove",
      id: arg(args, 0),
      yes: flag(values, "yes"),
    }),
  },
  "workspace group": {
    usage: "<id> <group>",
    minArgs: 2,
    maxArgs: 2,
    flags: [],
    build: (args) => ({ kind: "workspace.group", id: arg(args, 0), group: arg(args, 1) }),
  },
  "workspace ungroup": {
    usage: "<id>",
    minArgs: 1,
    maxArgs: 1,
    flags: [],
    build: (args) => ({ kind: "workspace.group", id: arg(args, 0), group: null }),
  },
  "workspace which": {
    usage: "[path]",
    minArgs: 0,
    maxArgs: 1,
    flags: ["json"],
    build: (args, values) => ({
      kind: "workspace.which",
      path: args[0] ?? null,
      json: flag(values, "json"),
    }),
  },
};

function lookup(name: string): CommandSpec | undefined {
  // Own keys only: "constructor" or "toString" must not resolve to Object.prototype members.
  return Object.hasOwn(COMMANDS, name) ? COMMANDS[name] : undefined;
}

function usage(message: string): ValidationError {
  return validationError(message, [{ path: "argv", message }]);
}

function resolveCommand(
  positionals: readonly string[],
): Result<{ name: string; spec: CommandSpec; args: readonly string[] }, ValidationError> {
  const [command, ...rest] = positionals;
  if (command === "workspace") {
    const [sub = "list", ...args] = rest;
    const name = `workspace ${sub}`;
    const spec = lookup(name);
    if (spec === undefined) return err(usage(`Unknown workspace command: ${sub}`));
    return ok({ name, spec, args });
  }
  const spec = command === undefined ? undefined : lookup(command);
  if (command === undefined || spec === undefined || command.includes(" ")) {
    return err(usage(`Unknown command: ${String(command)}`));
  }
  return ok({ name: command, spec, args: rest });
}

export function parseArgs(argv: readonly string[]): Result<CliInvocation, ValidationError> {
  let parsed: ReturnType<typeof parseNodeArgs>;
  try {
    parsed = parseNodeArgs({
      args: [...argv],
      strict: true,
      allowPositionals: true,
      options: {
        help: { type: "boolean", short: "h" },
        version: { type: "boolean", short: "v" },
        debug: { type: "boolean" },
        "log-level": { type: "string" },
        json: { type: "boolean" },
        name: { type: "string" },
        id: { type: "string" },
        group: { type: "string" },
        yes: { type: "boolean", short: "y" },
      },
    });
  } catch (thrown) {
    // node:util reports unknown flags and missing values by throwing; that is a usage error.
    return err(usage(thrown instanceof Error ? thrown.message : String(thrown)));
  }

  const { values, positionals } = parsed;
  if (values["help"] === true) return ok({ kind: "help" });
  if (values["version"] === true) return ok({ kind: "version" });
  if (positionals.length === 0) return ok({ kind: "help" });

  const resolved = resolveCommand(positionals);
  if (!resolved.ok) return resolved;
  const { name, spec, args } = resolved.value;

  for (const key of Object.keys(values)) {
    if (!GLOBAL_FLAGS.has(key) && !spec.flags.includes(key)) {
      return err(usage(`--${key} does not apply to ${name}`));
    }
  }
  if (args.length < spec.minArgs || args.length > spec.maxArgs) {
    return err(
      usage(
        spec.maxArgs === 0
          ? `Unexpected argument: ${args.join(" ")}`
          : `${name} expects ${spec.usage}`,
      ),
    );
  }

  const logLevel = values["log-level"];
  const level =
    typeof logLevel === "string" ? logLevel : values["debug"] === true ? "debug" : undefined;
  return ok({
    kind: "run",
    command: spec.build(args, values),
    overrides: level === undefined ? {} : { logging: { level } },
  });
}
