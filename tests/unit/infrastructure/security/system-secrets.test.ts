import { describe, expect, test } from "bun:test";
import type {
  ProcessOutput,
  ProcessRunner,
  ProcessSpec,
} from "../../../../src/application/ports/process-runner";
import { SecretRegistry } from "../../../../src/application/security/redaction";
import { ok } from "../../../../src/domain/shared/result";
import { describeSecretRef, secret } from "../../../../src/domain/shared/secret";
import { SystemSecrets } from "../../../../src/infrastructure/security/system-secrets";

/** A runner answering every call with `output`, remembering what it ran. */
function fakeRunner(output: Partial<ProcessOutput> = {}) {
  const specs: ProcessSpec[] = [];
  const runner: ProcessRunner = {
    run: (spec) => {
      specs.push(spec);
      return Promise.resolve(
        ok({ exitCode: 0, stdout: "", stderr: "", durationMs: 1, truncated: false, ...output }),
      );
    },
  };
  return { runner, specs };
}

const KEYCHAIN = { keychain: { service: "jira", account: "dana" } };

describe("secret", () => {
  test("hides its value from printing, logging and JSON; reveal gives it up", () => {
    const token = secret("s3cr3t-token-value");
    expect(String(token)).toBe("[REDACTED]");
    expect(`${token}`).toBe("[REDACTED]");
    expect(JSON.stringify({ token })).toBe('{"token":"[REDACTED]"}');
    expect(Bun.inspect(token)).not.toContain("s3cr3t");
    expect(token.reveal()).toBe("s3cr3t-token-value");
  });

  test("references are described without their values", () => {
    expect(describeSecretRef({ env: "JIRA_TOKEN" })).toBe("environment variable JIRA_TOKEN");
    expect(describeSecretRef(KEYCHAIN)).toBe("keychain item jira (dana)");
  });
});

describe("SystemSecrets", () => {
  test("reads the environment, and registers the value for masking", async () => {
    const registry = new SecretRegistry();
    const secrets = new SystemSecrets(
      { JIRA_PAT: "pat-0123456789" },
      fakeRunner().runner,
      "darwin",
      registry,
    );
    const found = await secrets.resolve({ env: "JIRA_PAT" });
    expect(found.ok && found.value.reveal()).toBe("pat-0123456789");
    expect(registry.values()).toEqual(["pat-0123456789"]);
  });

  test("a variable that is not set, or empty, is a configuration problem naming it", async () => {
    const secrets = new SystemSecrets(
      { EMPTY: "" },
      fakeRunner().runner,
      "darwin",
      new SecretRegistry(),
    );
    for (const name of ["MISSING", "EMPTY"]) {
      const found = await secrets.resolve({ env: name });
      expect(found.ok ? null : found.error).toMatchObject({
        kind: "configuration",
        message: `The environment variable ${name} is not set`,
      });
    }
  });

  test("on macOS, asks security for the item once, dropping its trailing newline", async () => {
    const { runner, specs } = fakeRunner({ stdout: "pat-from-keychain\n" });
    const registry = new SecretRegistry();
    const secrets = new SystemSecrets({}, runner, "darwin", registry);
    const first = await secrets.resolve(KEYCHAIN);
    const again = await secrets.resolve(KEYCHAIN);
    expect(first.ok && first.value.reveal()).toBe("pat-from-keychain");
    expect(again.ok && again.value.reveal()).toBe("pat-from-keychain");
    expect(specs).toHaveLength(1);
    expect(specs[0]).toMatchObject({
      command: "security",
      args: ["find-generic-password", "-s", "jira", "-a", "dana", "-w"],
    });
    expect(registry.values()).toEqual(["pat-from-keychain"]);
  });

  test("an item that is not there says how to add it", async () => {
    const { runner } = fakeRunner({ exitCode: 44 });
    const found = await new SystemSecrets({}, runner, "darwin", new SecretRegistry()).resolve(
      KEYCHAIN,
    );
    expect(found.ok ? null : found.error).toMatchObject({
      kind: "configuration",
      message: "No keychain item for jira (dana)",
      issues: [
        {
          path: "jira/dana",
          message: "add it with: security add-generic-password -s jira -a dana -w",
        },
      ],
    });
  });

  test("a keychain that will not answer is a failure of the tool", async () => {
    const { runner } = fakeRunner({ exitCode: 51 });
    const found = await new SystemSecrets({}, runner, "darwin", new SecretRegistry()).resolve(
      KEYCHAIN,
    );
    expect(found.ok ? null : found.error).toMatchObject({ kind: "process", exitCode: 51 });
  });

  test("on Linux, asks secret-tool over the session bus", async () => {
    const { runner, specs } = fakeRunner({ stdout: "pat-from-secret-service" });
    const secrets = new SystemSecrets(
      { DBUS_SESSION_BUS_ADDRESS: "unix:path=/run/user/1000/bus" },
      runner,
      "linux",
      new SecretRegistry(),
    );
    const found = await secrets.resolve(KEYCHAIN);
    expect(found.ok && found.value.reveal()).toBe("pat-from-secret-service");
    expect(specs[0]).toMatchObject({
      command: "secret-tool",
      args: ["lookup", "service", "jira", "account", "dana"],
      env: { DBUS_SESSION_BUS_ADDRESS: "unix:path=/run/user/1000/bus" },
    });
    const missing = await new SystemSecrets(
      {},
      fakeRunner({ exitCode: 1 }).runner,
      "linux",
      new SecretRegistry(),
    ).resolve(KEYCHAIN);
    expect(missing.ok ? null : missing.error.kind).toBe("configuration");
  });

  test("elsewhere, the keychain is not offered", async () => {
    const { runner, specs } = fakeRunner();
    const found = await new SystemSecrets({}, runner, "win32", new SecretRegistry()).resolve(
      KEYCHAIN,
    );
    expect(found.ok ? null : found.error.message).toBe("XueFu cannot read the keychain on win32");
    expect(specs).toEqual([]);
  });
});
