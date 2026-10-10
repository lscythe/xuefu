import { z } from "zod";
import type { SecretRef } from "../../domain/shared/secret";

const envName = z
  .string()
  .regex(/^[A-Za-z_][A-Za-z0-9_]*$/, "must be an environment variable's name, such as JIRA_TOKEN");

/**
 * Where config says a credential is kept. A plain string is refused, so a token pasted into
 * config.yml is caught before it is ever used.
 */
export const SecretRefSchema: z.ZodType<SecretRef> = z.union(
  [
    z.strictObject({ env: envName }),
    z.strictObject({
      keychain: z.strictObject({ service: z.string().min(1), account: z.string().min(1) }),
    }),
  ],
  {
    error:
      "must say where the credential is kept, as { env: NAME } or { keychain: { service, account } }, never the credential itself",
  },
);
