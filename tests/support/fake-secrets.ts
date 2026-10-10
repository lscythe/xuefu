import type { SecretProvider } from "../../src/application/ports/secret-provider";
import { configurationError } from "../../src/domain/shared/errors";
import { err, ok } from "../../src/domain/shared/result";
import { describeSecretRef, secret } from "../../src/domain/shared/secret";

/** Secrets from a fixed table keyed by environment variable or keychain service; others are missing. */
export function fakeSecrets(values: Readonly<Record<string, string>> = {}): SecretProvider {
  return {
    resolve: (ref) => {
      const value = values["env" in ref ? ref.env : ref.keychain.service];
      return Promise.resolve(
        value === undefined
          ? err(
              configurationError(`${describeSecretRef(ref)} is not set`, "environment", [
                { path: "env" in ref ? ref.env : ref.keychain.service, message: "missing" },
              ]),
            )
          : ok(secret(value)),
      );
    },
  };
}
