import { parseArgs as parseNodeArgs } from "node:util";
import { type ValidationError, validationError } from "../domain/shared/errors";
import { err, ok, type Result } from "../domain/shared/result";

export type CliInvocation =
  | { readonly kind: "help" }
  | { readonly kind: "version" }
  | {
      readonly kind: "diagnostics";
      readonly json: boolean;
      /** Raw config overrides; validated by the configuration layer like any other source. */
      readonly overrides: Readonly<Record<string, unknown>>;
    };

function usage(message: string): ValidationError {
  return validationError(message, [{ path: "argv", message }]);
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
      },
    });
  } catch (thrown) {
    // node:util reports unknown flags and missing values by throwing; that is a usage error.
    return err(usage(thrown instanceof Error ? thrown.message : String(thrown)));
  }

  const { values, positionals } = parsed;
  if (values["help"] === true) return ok({ kind: "help" });
  if (values["version"] === true) return ok({ kind: "version" });

  const [command, ...rest] = positionals;
  if (command === undefined) return ok({ kind: "help" });
  if (command !== "diagnostics") return err(usage(`Unknown command: ${command}`));
  if (rest.length > 0) return err(usage(`Unexpected argument: ${rest.join(" ")}`));

  const logLevel = values["log-level"];
  const level =
    typeof logLevel === "string" ? logLevel : values["debug"] === true ? "debug" : undefined;
  return ok({
    kind: "diagnostics",
    json: values["json"] === true,
    overrides: level === undefined ? {} : { logging: { level } },
  });
}
