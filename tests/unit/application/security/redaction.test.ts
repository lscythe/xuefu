import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import {
  createRedactor,
  REDACTED,
  SecretRegistry,
} from "../../../../src/application/security/redaction";

const redactor = () => createRedactor(new SecretRegistry());

describe("redactString: value patterns", () => {
  test.each([
    ["Authorization: Bearer abc.def-123_xyz", "Authorization: Bearer [REDACTED]"],
    ["Basic dXNlcjpwYXNzd29yZA==", "Basic [REDACTED]"],
    ["https://james:hunter22@bitbucket.org/repo.git", "https://[REDACTED]@bitbucket.org/repo.git"],
    ["https://x-token-auth@bitbucket.org/repo.git", "https://[REDACTED]@bitbucket.org/repo.git"],
    ["GET /rest?api_key=s3cr3t&page=2", "GET /rest?api_key=[REDACTED]&page=2"],
    ["callback?access_token=zzz#frag", "callback?access_token=[REDACTED]#frag"],
    ["password=hunter2 user=james", "password=[REDACTED] user=james"],
    ["token: abcdef", "token: [REDACTED]"],
    ["jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJl end", "jwt [REDACTED] end"],
    ["ghp_abcdefghijklmnopqrstuvwxyz0123456789", "[REDACTED]"],
    ["github_pat_11ABCDEFG0123456789_abcdefghijklmnop", "[REDACTED]"],
    ["ATATT3xFfGF0abcdefghijklmnopqrstuvwxyz=ABCD1234", "[REDACTED]"],
    [
      "https://api.telegram.org/bot123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw/getMe",
      "https://api.telegram.org/bot[REDACTED]/getMe",
    ],
    ["xoxb-123456789012-abcdefghijkl", "[REDACTED]"],
    ["Authorization: Token 0123456789abcdef0123456789", "Authorization: Token [REDACTED]"],
  ])("%s", (input, expected) => {
    expect(redactor().redactString(input)).toBe(expected);
  });

  test("redacts PEM private key blocks", () => {
    const pem = "-----BEGIN RSA PRIVATE KEY-----\nMIIEow\nabc\n-----END RSA PRIVATE KEY-----";
    expect(redactor().redactString(`key:\n${pem}\nafter`)).toBe(`key:\n${REDACTED}\nafter`);
  });

  test("leaves ordinary developer text alone", () => {
    const text =
      "feat(auth): add token refresh; Token rotation; Bot replies; tokens: 5; max_token=3; MOB-2841 on feature/x";
    expect(redactor().redactString(text)).toBe(text);
  });
});

describe("redactString: registered secrets", () => {
  test("masks exact registered values anywhere in text", () => {
    const registry = new SecretRegistry();
    registry.register("Zx9-plain-looking-value");
    const r = createRedactor(registry);
    expect(r.redactString("failed with Zx9-plain-looking-value in body")).toBe(
      `failed with ${REDACTED} in body`,
    );
  });

  test("masks longer secrets before shorter overlapping ones", () => {
    const registry = new SecretRegistry();
    registry.register("abcdef");
    registry.register("abcdefghij");
    expect(createRedactor(registry).redactString("xx abcdefghij yy")).toBe(`xx ${REDACTED} yy`);
  });

  test("ignores values too short to mask safely", () => {
    const registry = new SecretRegistry();
    expect(registry.register("abc")).toBe(false);
    expect(createRedactor(registry).redactString("abc")).toBe("abc");
  });
});

describe("redactValue: structures", () => {
  test("masks sensitive keys regardless of casing and separators", () => {
    const out = redactor().redactValue({
      jiraToken: "t1",
      API_KEY: "k",
      "x-api-key": "k2",
      Authorization: "Bearer x",
      password: 123,
      nested: { client_secret: "s", ok: "fine" },
      tokenCount: 4,
    });
    expect(out).toEqual({
      jiraToken: REDACTED,
      API_KEY: REDACTED,
      "x-api-key": REDACTED,
      Authorization: REDACTED,
      password: REDACTED,
      nested: { client_secret: REDACTED, ok: "fine" },
      tokenCount: 4,
    });
  });

  test("summarises errors and redacts their messages", () => {
    const out = redactor().redactValue({ error: new Error("401 for Bearer abcdefgh") });
    expect(out).toEqual({ error: { name: "Error", message: "401 for Bearer [REDACTED]" } });
  });

  test("handles cycles, depth, functions, bigint and dates", () => {
    const cyclic: Record<string, unknown> = { a: 1 };
    cyclic["self"] = cyclic;
    let deep: Record<string, unknown> = { leaf: true };
    for (let i = 0; i < 20; i += 1) deep = { deep };
    const out = redactor().redactValue({
      cyclic,
      deep,
      fn: () => 1,
      big: 10n,
      at: new Date(0),
    }) as Record<string, unknown>;
    expect(out["cyclic"]).toEqual({ a: 1, self: "[Circular]" });
    expect(JSON.stringify(out["deep"])).toContain("[Truncated]");
    expect(out["fn"]).toBe("[Function]");
    expect(out["big"]).toBe("10");
    expect(out["at"]).toBe("1970-01-01T00:00:00.000Z");
  });

  test("regression: PWD-style keys are not treated as credentials", () => {
    expect(redactor().redactValue({ PWD: "/Users/dev", cwd: "/tmp" })).toEqual({
      PWD: "/Users/dev",
      cwd: "/tmp",
    });
  });

  test("redacts sensitive keys whose values are objects", () => {
    expect(redactor().redactValue({ credentials: { user: "a", pass: "b" } })).toEqual({
      credentials: REDACTED,
    });
  });
});

const secretArbitrary = fc.stringMatching(/^[A-Za-z0-9_\-.:/+=]{8,40}$/);
const noise = fc.string({ maxLength: 30 });

describe("redaction invariants", () => {
  test("property: a registered secret never survives in redacted strings", () => {
    fc.assert(
      fc.property(secretArbitrary, noise, noise, (secret, before, after) => {
        const registry = new SecretRegistry();
        registry.register(secret);
        const out = createRedactor(registry).redactString(before + secret + after);
        expect(out.includes(secret)).toBe(false);
      }),
    );
  });

  test("property: a registered secret never survives in serialised structures", () => {
    fc.assert(
      fc.property(secretArbitrary, fc.jsonValue({ maxDepth: 3 }), (secret, json) => {
        const registry = new SecretRegistry();
        registry.register(secret);
        const payload = { data: json, message: `boom ${secret}`, list: [secret], [secret]: 1 };
        const serialised = JSON.stringify(createRedactor(registry).redactValue(payload));
        expect(serialised.includes(secret)).toBe(false);
      }),
    );
  });

  test("property: redaction is idempotent", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 200 }), (text) => {
        const r = redactor();
        const once = r.redactString(text);
        expect(r.redactString(once)).toBe(once);
      }),
    );
  });
});
