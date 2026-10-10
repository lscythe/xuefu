import { z } from "zod";

export const CURRENT_CONFIG_VERSION = 1;

const LogLevelSchema = z.enum(["trace", "debug", "info", "warn", "error"]);

export const GlobalConfigSchema = z.strictObject({
  version: z.literal(CURRENT_CONFIG_VERSION),
  logging: z.strictObject({
    level: LogLevelSchema,
    maxFileBytes: z
      .int()
      .min(64 * 1024)
      .max(1024 * 1024 * 1024),
    maxFiles: z.int().min(1).max(20),
  }),
  telemetry: z.strictObject({
    enabled: z.boolean(),
  }),
  ui: z.strictObject({
    icons: z.enum(["nerd", "unicode", "ascii"]),
  }),
  /** Settings per plugin, by id; each plugin checks its own when XueFu starts. */
  plugins: z.record(z.string(), z.record(z.string(), z.unknown())),
});

export type GlobalConfig = z.infer<typeof GlobalConfigSchema>;

export const DEFAULT_CONFIG: GlobalConfig = Object.freeze({
  version: CURRENT_CONFIG_VERSION,
  logging: Object.freeze({ level: "info", maxFileBytes: 5 * 1024 * 1024, maxFiles: 3 }),
  telemetry: Object.freeze({ enabled: false }),
  ui: Object.freeze({ icons: "unicode" }),
  plugins: Object.freeze({}),
});

/** Same shape with every key optional at every depth; still strict about unknown keys. */
function deepPartial(schema: z.ZodType): z.ZodType {
  if (schema instanceof z.ZodObject) {
    const shape: Record<string, z.ZodType> = {};
    for (const [key, value] of Object.entries(schema.shape as Record<string, z.ZodType>)) {
      shape[key] = deepPartial(value).optional();
    }
    return z.strictObject(shape);
  }
  return schema;
}

/** Validates a single source (file, env, CLI) before merging, so errors name their origin. */
export const ConfigLayerSchema = deepPartial(GlobalConfigSchema);
