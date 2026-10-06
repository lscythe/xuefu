import type { z } from "zod";
import { isSensitiveKey } from "../../application/security/redaction";
import {
  type ConfigurationError,
  type ConfigurationIssue,
  configurationError,
} from "../../domain/shared/errors";
import { err, ok, type Result } from "../../domain/shared/result";
import { isPlainObject, mergeLayers, type PlainObject } from "./merge";
import {
  ConfigLayerSchema,
  CURRENT_CONFIG_VERSION,
  DEFAULT_CONFIG,
  type GlobalConfig,
  GlobalConfigSchema,
} from "./schema";
import { parseYamlSource, type YamlSource } from "./yaml-source";

export interface ConfigInput {
  readonly globalFile: { readonly path: string; readonly text: string | null };
  readonly env: Readonly<Record<string, string | undefined>>;
  /** Raw overrides from command-line flags; validated like any other layer. */
  readonly cli: PlainObject;
}

export type ConfigSource =
  | { readonly name: "defaults" }
  | { readonly name: "global"; readonly path: string }
  | { readonly name: "environment"; readonly variables: readonly string[] }
  | { readonly name: "cli" };

export interface LoadedConfig {
  readonly config: GlobalConfig;
  readonly sources: readonly ConfigSource[];
}

/** Explicit, documented environment mapping, no generic XUEFU_A__B magic. */
const ENVIRONMENT_MAPPING: Readonly<Record<string, readonly [string, string]>> = {
  XUEFU_LOG_LEVEL: ["logging", "level"],
};

const FIX_HINT = "Fix the listed keys, then run `xuefu diagnostics` to verify.";
const SECRET_HINT =
  "Do not store secrets in config files. Reference them instead, e.g. `token: { env: JIRA_TOKEN }` " +
  "or `token: { keychain: { service: xuefu, account: jira } }`.";

type Locate = YamlSource["locate"];

function issuesFromZod(error: z.ZodError, locate: Locate | null): ConfigurationIssue[] {
  return error.issues.flatMap((issue) => {
    const keys = issue.code === "unrecognized_keys" ? issue.keys : [undefined];
    return keys.map((key) => {
      const segments = key === undefined ? issue.path : [...issue.path, key];
      const position = locate?.(issue.path, key) ?? null;
      const message = key === undefined ? issue.message : `Unknown key "${key}"`;
      return {
        path: segments.map(String).join("."),
        message,
        ...(position === null ? {} : { line: position.line, column: position.column }),
      };
    });
  });
}

/** Finds string values under credential-like keys. Never includes the value in the issue. */
function findPlaintextSecrets(
  node: unknown,
  locate: Locate,
  path: readonly string[] = [],
): ConfigurationIssue[] {
  if (!isPlainObject(node)) return [];
  return Object.entries(node).flatMap(([key, value]) => {
    if (isSensitiveKey(key) && typeof value === "string") {
      const position = locate(path, key);
      return [
        {
          path: [...path, key].join("."),
          message: "Plaintext secret in configuration file",
          ...(position === null ? {} : { line: position.line, column: position.column }),
        },
      ];
    }
    return findPlaintextSecrets(value, locate, [...path, key]);
  });
}

function parseFileLayer(
  path: string,
  text: string,
): Result<PlainObject | null, ConfigurationError> {
  const parsed = parseYamlSource(text);
  if (!parsed.ok) {
    return err(
      configurationError(`Configuration file is not valid YAML: ${path}`, path, parsed.error),
    );
  }
  const { data, locate } = parsed.value;
  if (data === null || data === undefined) return ok(null);
  if (!isPlainObject(data)) {
    return err(
      configurationError(`Configuration file must contain a mapping: ${path}`, path, [
        { path: "", message: "expected key: value pairs at the top level", line: 1, column: 1 },
      ]),
    );
  }

  const version = data["version"];
  if (version === undefined) {
    return err(
      configurationError(
        `Configuration file has no version: ${path}`,
        path,
        [{ path: "version", message: "missing", line: 1, column: 1 }],
        { hint: `Add \`version: ${CURRENT_CONFIG_VERSION}\` as the first line.` },
      ),
    );
  }
  if (
    typeof version === "number" &&
    Number.isInteger(version) &&
    version > CURRENT_CONFIG_VERSION
  ) {
    return err(
      configurationError(
        `Configuration file was written for a newer XueFu: ${path}`,
        path,
        [
          {
            path: "version",
            message: `version ${version} is not supported (max ${CURRENT_CONFIG_VERSION})`,
          },
        ],
        { hint: "Upgrade XueFu, or restore a configuration file for this version." },
      ),
    );
  }

  const secrets = findPlaintextSecrets(data, locate);
  if (secrets.length > 0) {
    return err(
      configurationError(`Configuration file contains plaintext secrets: ${path}`, path, secrets, {
        hint: SECRET_HINT,
      }),
    );
  }

  const validated = ConfigLayerSchema.safeParse(data);
  if (!validated.success) {
    return err(
      configurationError(
        `Invalid configuration in ${path}`,
        path,
        issuesFromZod(validated.error, locate),
        {
          hint: FIX_HINT,
        },
      ),
    );
  }
  return ok(data);
}

function environmentLayer(
  env: ConfigInput["env"],
): Result<{ layer: PlainObject; variables: string[] }, ConfigurationError> {
  const layer: PlainObject = {};
  const variables: string[] = [];
  const issues: ConfigurationIssue[] = [];
  for (const [variable, [section, key]] of Object.entries(ENVIRONMENT_MAPPING)) {
    const value = env[variable];
    if (value === undefined || value === "") continue;
    const candidate = { [section]: { [key]: value } };
    const validated = ConfigLayerSchema.safeParse(candidate);
    if (!validated.success) {
      for (const issue of validated.error.issues)
        issues.push({ path: variable, message: issue.message });
      continue;
    }
    variables.push(variable);
    Object.assign(layer, mergeLayers([layer, candidate]));
  }
  if (issues.length > 0) {
    return err(
      configurationError("Invalid configuration in environment variables", "environment", issues),
    );
  }
  return ok({ layer, variables });
}

export function loadConfig(input: ConfigInput): Result<LoadedConfig, ConfigurationError> {
  const layers: PlainObject[] = [DEFAULT_CONFIG];
  const sources: ConfigSource[] = [{ name: "defaults" }];

  if (input.globalFile.text !== null) {
    const fileLayer = parseFileLayer(input.globalFile.path, input.globalFile.text);
    if (!fileLayer.ok) return fileLayer;
    if (fileLayer.value !== null) {
      layers.push(fileLayer.value);
      sources.push({ name: "global", path: input.globalFile.path });
    }
  }

  const envLayer = environmentLayer(input.env);
  if (!envLayer.ok) return envLayer;
  if (envLayer.value.variables.length > 0) {
    layers.push(envLayer.value.layer);
    sources.push({ name: "environment", variables: envLayer.value.variables });
  }

  if (Object.keys(input.cli).length > 0) {
    const validated = ConfigLayerSchema.safeParse(input.cli);
    if (!validated.success) {
      return err(
        configurationError(
          "Invalid command-line option",
          "cli",
          issuesFromZod(validated.error, null),
        ),
      );
    }
    layers.push(input.cli);
    sources.push({ name: "cli" });
  }

  const resolved = GlobalConfigSchema.safeParse(mergeLayers(layers));
  if (!resolved.success) {
    // Every layer was valid on its own, so this means DEFAULT_CONFIG is incomplete: a XueFu bug.
    return err(
      configurationError(
        "Resolved configuration is invalid",
        "defaults",
        issuesFromZod(resolved.error, null),
      ),
    );
  }
  return ok({ config: resolved.data, sources });
}
