import type { AppError } from "../application/errors";
import type { Result } from "../domain/shared/result";
import type { Workspace } from "../domain/workspace/workspace";

/** A flag a plugin's command takes, parsed like the core's own. */
interface PluginFlag {
  readonly type: "boolean" | "string";
  readonly short?: string;
  /** Shown after the flag in help, e.g. "<id>". */
  readonly value?: string;
  readonly description: string;
}

/**
 * A command a plugin adds under its own name, e.g. `xuefu git status`. Declared up front so
 * arguments are checked, and help written, before XueFu starts.
 */
export interface PluginCommandSpec {
  /** The plugin's id, which is the first word of the command. */
  readonly group: string;
  readonly name: string;
  /** Run when only the group is given, as `xuefu git` runs `xuefu git status`. */
  readonly isDefault?: boolean;
  /** Positional arguments as shown in help and usage errors. */
  readonly usage: string;
  readonly minArgs: number;
  readonly maxArgs: number;
  readonly flags: Readonly<Record<string, PluginFlag>>;
  /** One line for help. */
  readonly summary: string;
}

/** A plugin command as typed, checked against its spec. */
export interface PluginInvocation {
  readonly group: string;
  readonly name: string;
  readonly args: readonly string[];
  readonly flags: Readonly<Record<string, string | boolean | undefined>>;
}

/** What a plugin's command may use from the CLI. */
interface PluginCommandIo {
  /** The workspace with this id, or the one containing the current folder when null. */
  readonly workspace: (id: string | null) => Promise<Result<Workspace, AppError>>;
  readonly stdout: (text: string) => void;
  readonly stderr: (text: string) => void;
}

/** Runs a plugin's commands; resolves to the exit code, or an error the CLI reports. */
export type PluginCommandRunner = (
  invocation: PluginInvocation,
  io: PluginCommandIo,
) => Promise<Result<number, AppError>>;
