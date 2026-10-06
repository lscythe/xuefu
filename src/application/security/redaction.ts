export const REDACTED = "[REDACTED]";

/** Shorter values would mask ordinary words and still leak little; real credentials are longer. */
const MIN_SECRET_LENGTH = 6;
const MAX_DEPTH = 8;

/**
 * Holds secret values resolved at runtime (env vars, keychain) so they can be masked by exact
 * match anywhere they appear, including places no pattern would recognise.
 */
export class SecretRegistry {
  readonly #values = new Set<string>();
  #sorted: readonly string[] = [];

  register(value: string): boolean {
    if (value.length < MIN_SECRET_LENGTH) return false;
    if (!this.#values.has(value)) {
      this.#values.add(value);
      // Longest first so a secret containing another secret is masked whole.
      this.#sorted = [...this.#values].sort((a, b) => b.length - a.length);
    }
    return true;
  }

  values(): readonly string[] {
    return this.#sorted;
  }
}

export interface Redactor {
  redactString(text: string): string;
  /** Deep copy suitable for serialisation, with sensitive keys and values masked. */
  redactValue(value: unknown): unknown;
}

const SENSITIVE_KEYS = new Set([
  "authorization",
  "proxyauthorization",
  "cookie",
  "setcookie",
  "apikey",
  "xapikey",
  "privatekey",
  "passphrase",
  "credential",
  "credentials",
  "sessionid",
  "jsessionid",
  // Not "pwd": $PWD is the working directory, and redacting it hides every path.
  "passwd",
]);

const SENSITIVE_SUFFIXES = ["token", "secret", "password"];

/** True for keys whose values are credentials (`jiraToken`, `API_KEY`, `Authorization`, …). */
export function isSensitiveKey(key: string): boolean {
  const normalised = key.toLowerCase().replace(/[-_.\s]/g, "");
  return (
    SENSITIVE_KEYS.has(normalised) ||
    SENSITIVE_SUFFIXES.some((suffix) => normalised.endsWith(suffix))
  );
}

interface Rule {
  readonly pattern: RegExp;
  readonly replacement: string;
}

const RULES: readonly Rule[] = [
  {
    pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
    replacement: REDACTED,
  },
  // Provider token shapes first, so generic rules don't leave partial remnants.
  {
    pattern: /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}/g,
    replacement: REDACTED,
  },
  {
    pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})/g,
    replacement: REDACTED,
  },
  { pattern: /\bATATT[A-Za-z0-9_\-=]{20,}/g, replacement: REDACTED },
  { pattern: /\bxox[abprs]-[A-Za-z0-9-]{10,}/g, replacement: REDACTED },
  { pattern: /(?<![0-9])[0-9]{6,12}:[A-Za-z0-9_-]{30,}/g, replacement: REDACTED },
  { pattern: /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{6,}/gi, replacement: `$1 ${REDACTED}` },
  // "Token"/"Bot" are also English words, so require exact scheme casing and a credential length.
  { pattern: /\b(Token|Bot)\s+[A-Za-z0-9._~+/=-]{20,}/g, replacement: `$1 ${REDACTED}` },
  // scheme://user[:password]@host
  {
    pattern: /(\b[a-z][a-z0-9+.-]*:\/\/)[^\s/@:[]+(?::[^\s/@]*)?@/gi,
    replacement: `$1${REDACTED}@`,
  },
  {
    pattern:
      /([?&](?:access_token|refresh_token|token|api_key|apikey|key|password|secret|sig|signature|auth)=)[^&\s#"'[]+/gi,
    replacement: `$1${REDACTED}`,
  },
  {
    pattern:
      /\b(password|passwd|secret|token|api[_-]?key)(\s*[=:]\s*)(?!\[REDACTED\])[^\s"'&,;]+/gi,
    replacement: `$1$2${REDACTED}`,
  },
];

export function createRedactor(registry: SecretRegistry): Redactor {
  const redactString = (text: string): string => {
    let out = text;
    for (const secret of registry.values()) {
      if (out.includes(secret)) out = out.split(secret).join(REDACTED);
    }
    for (const rule of RULES) {
      out = out.replace(rule.pattern, rule.replacement);
    }
    return out;
  };

  const redactValue = (value: unknown, depth: number, seen: WeakSet<object>): unknown => {
    switch (typeof value) {
      case "string":
        return redactString(value);
      case "number":
      case "boolean":
      case "undefined":
        return value;
      case "bigint":
        return value.toString();
      case "symbol":
        return value.toString();
      case "function":
        return "[Function]";
      case "object":
        break;
    }
    if (value === null) return null;
    if (depth >= MAX_DEPTH) return "[Truncated]";
    if (seen.has(value)) return "[Circular]";
    if (value instanceof Date) return value.toISOString();
    if (value instanceof Error) {
      return { name: value.name, message: redactString(value.message) };
    }
    seen.add(value);
    try {
      if (Array.isArray(value)) return value.map((item) => redactValue(item, depth + 1, seen));
      const out: Record<string, unknown> = {};
      for (const [key, inner] of Object.entries(value)) {
        out[redactString(key)] = isSensitiveKey(key)
          ? REDACTED
          : redactValue(inner, depth + 1, seen);
      }
      return out;
    } finally {
      // Siblings may legitimately share a reference; only ancestors count as cycles.
      seen.delete(value);
    }
  };

  return {
    redactString,
    redactValue: (value) => redactValue(value, 0, new WeakSet()),
  };
}
