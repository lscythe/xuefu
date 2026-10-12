import type { PluginCommandSpec } from "./plugin-command";

/** One argument a tool takes, by name. */
interface ToolParameter {
  readonly type: "string" | "boolean" | "integer";
  readonly description: string;
  readonly required?: boolean;
}

type ToolValues = Readonly<Record<string, string | boolean>>;

/**
 * A XueFu command served to agents as an MCP tool. Calling it runs the command as `argv` would on
 * the command line, so a tool does exactly what the command does.
 */
export interface McpTool {
  readonly name: string;
  readonly description: string;
  readonly parameters: Readonly<Record<string, ToolParameter>>;
  /** It changes something, so harnesses ask before running it; reads they may run freely. */
  readonly changes: boolean;
  /** The command line to run, from arguments already checked against the parameters. */
  argv(values: ToolValues): string[];
}

const workspace: ToolParameter = {
  type: "string",
  description: "the workspace's id; by default the one the agent runs in",
};
const issue: ToolParameter = { type: "string", description: "the issue's key, such as MOB-123" };

/** `--name=value` for each value given, so a value starting with "-" stays a value. */
function flags(values: ToolValues, names: readonly string[]): string[] {
  return names.flatMap((name) => {
    const value = values[name];
    if (value === undefined || value === false) return [];
    return value === true ? [`--${name}`] : [`--${name}=${value}`];
  });
}

/** Positional arguments go after `--`, so none is read as a flag. */
const positional = (...values: (string | boolean | undefined)[]): string[] => {
  const given = values.filter((value) => typeof value === "string");
  return given.length === 0 ? [] : ["--", ...given];
};

/** The core's commands an agent has a use for; those that need a terminal or stdin are left out. */
const CORE_TOOLS: readonly McpTool[] = [
  {
    name: "workspace_list",
    description: "List the workspaces XueFu tracks, with their folders and tools",
    parameters: {},
    changes: false,
    argv: () => ["workspace", "list", "--json"],
  },
  {
    name: "work_status",
    description: "Show the work in progress in every workspace: the issue and when it started",
    parameters: {},
    changes: false,
    argv: () => ["work", "status", "--json"],
  },
  {
    name: "work_start",
    description: "Work on an issue in a workspace and time it; finishes other work there",
    parameters: {
      issue: { ...issue, required: true },
      title: { type: "string", description: "what the issue is about" },
      workspace,
    },
    changes: true,
    argv: (values) => [
      "work",
      "start",
      ...flags(values, ["title", "workspace"]),
      ...positional(values["issue"]),
    ],
  },
  {
    name: "work_finish",
    description: "Finish the work in progress in a workspace and stop its timer",
    parameters: { workspace },
    changes: true,
    argv: (values) => ["work", "finish", ...flags(values, ["workspace"])],
  },
  {
    name: "timer_status",
    description: "Show the running or paused timer, if any",
    parameters: {},
    changes: false,
    argv: () => ["timer", "status", "--json"],
  },
  {
    name: "note_show",
    description: "Show the note kept for a workspace, or for an issue in it",
    parameters: { issue: { ...issue, description: "the note on this issue instead" }, workspace },
    changes: false,
    argv: (values) => ["note", "show", "--json", ...flags(values, ["issue", "workspace"])],
  },
  {
    name: "note_append",
    description: "Add a line to the note kept for a workspace, or for an issue in it",
    parameters: {
      text: { type: "string", description: "the line to add", required: true },
      issue: { ...issue, description: "the note on this issue instead" },
      workspace,
    },
    changes: true,
    argv: (values) => [
      "note",
      "append",
      ...flags(values, ["issue", "workspace"]),
      ...positional(values["text"]),
    ],
  },
  {
    name: "activity",
    description: "Show what happened in XueFu, newest first",
    parameters: {
      workspace: { type: "string", description: "only in this workspace" },
      limit: { type: "integer", description: "how many entries, from 1 to 1000 (default 20)" },
    },
    changes: false,
    argv: (values) => ["activity", "--json", ...flags(values, ["workspace", "limit"])],
  },
];

/**
 * A plugin's command as a tool named `<group>_<name>`. Machine-readable output is asked for
 * whenever the command has it, so it is not an argument.
 */
function pluginTool(spec: PluginCommandSpec): McpTool {
  const names = Object.keys(spec.flags).filter((name) => name !== "json");
  const argument = spec.maxArgs > 0 ? (spec.argument ?? null) : null;
  return {
    name: `${spec.group}_${spec.name}`.replaceAll("-", "_"),
    description: spec.summary,
    parameters: {
      ...(argument === null
        ? {}
        : {
            [argument.name]: {
              type: "string",
              description: argument.description,
              ...(spec.minArgs > 0 ? { required: true } : {}),
            },
          }),
      ...Object.fromEntries(
        names.map((name): [string, ToolParameter] => {
          const flag = spec.flags[name];
          return [name, { type: flag?.type ?? "string", description: flag?.description ?? name }];
        }),
      ),
    },
    changes: spec.changes === true,
    argv: (values) => [
      spec.group,
      spec.name,
      ...("json" in spec.flags ? ["--json"] : []),
      ...flags(values, names),
      ...positional(argument === null ? undefined : values[argument.name]),
    ],
  };
}

/** Every tool: the core's, then each plugin's commands. */
export function mcpTools(plugins: readonly PluginCommandSpec[]): readonly McpTool[] {
  return [...CORE_TOOLS, ...plugins.map(pluginTool)];
}

/** The JSON Schema MCP clients read a tool's arguments from. */
export function inputSchema(tool: McpTool) {
  const entries = Object.entries(tool.parameters);
  return {
    type: "object",
    properties: Object.fromEntries(
      entries.map(([name, parameter]) => [
        name,
        { type: parameter.type, description: parameter.description },
      ]),
    ),
    required: entries.filter(([, parameter]) => parameter.required === true).map(([name]) => name),
    additionalProperties: false,
  } as const;
}

/**
 * The arguments an agent sent, checked against the tool's parameters; a message saying what is
 * wrong otherwise. Numbers are taken for text, since agents send line numbers and ids as numbers.
 */
export function toolValues(
  tool: McpTool,
  given: unknown,
):
  | { readonly ok: true; readonly values: ToolValues }
  | { readonly ok: false; readonly message: string } {
  if (
    given !== undefined &&
    (typeof given !== "object" || given === null || Array.isArray(given))
  ) {
    return { ok: false, message: "Arguments must be an object" };
  }
  const raw = (given ?? {}) as Readonly<Record<string, unknown>>;
  const values: Record<string, string | boolean> = {};
  for (const [name, value] of Object.entries(raw)) {
    const parameter = Object.hasOwn(tool.parameters, name) ? tool.parameters[name] : undefined;
    if (parameter === undefined) return { ok: false, message: `Unknown argument: ${name}` };
    if (value === null || value === undefined) continue;
    if (parameter.type === "boolean") {
      if (typeof value !== "boolean")
        return { ok: false, message: `${name} must be true or false` };
      values[name] = value;
    } else if (parameter.type === "integer") {
      if (!Number.isInteger(value)) return { ok: false, message: `${name} must be a whole number` };
      values[name] = String(value);
    } else if (typeof value === "string" || (typeof value === "number" && Number.isFinite(value))) {
      values[name] = String(value);
    } else {
      return { ok: false, message: `${name} must be text` };
    }
  }
  const missing = Object.entries(tool.parameters)
    .filter(([name, parameter]) => parameter.required === true && values[name] === undefined)
    .map(([name]) => name);
  if (missing.length > 0) return { ok: false, message: `Missing argument: ${missing.join(", ")}` };
  return { ok: true, values };
}
