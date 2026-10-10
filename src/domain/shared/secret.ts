/** Where a credential is kept: never the credential itself. */
export type SecretRef =
  | { readonly env: string }
  | { readonly keychain: { readonly service: string; readonly account: string } };

/**
 * A credential's value. Printing, logging or serialising it shows a mask; only `reveal` gives the
 * value up, so it leaves XueFu only where code asks for it by name.
 */
export interface Secret {
  reveal(): string;
  toString(): string;
  toJSON(): string;
}

const MASK = "[REDACTED]";

export function secret(value: string): Secret {
  return Object.freeze({
    reveal: () => value,
    toString: () => MASK,
    toJSON: () => MASK,
    [Symbol.for("nodejs.util.inspect.custom")]: () => MASK,
  });
}

/** Where the reference points, for messages: "JIRA_TOKEN" or "keychain item jira (dana)". */
export function describeSecretRef(ref: SecretRef): string {
  return "env" in ref
    ? `environment variable ${ref.env}`
    : `keychain item ${ref.keychain.service} (${ref.keychain.account})`;
}
