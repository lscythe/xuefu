import { describe, expect, test } from "bun:test";
import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import type { AbsolutePath } from "../../../../src/domain/shared/path";
import {
  BunProcessRunner,
  childEnvironment,
} from "../../../../src/infrastructure/process/bun-process-runner";

const BUN = process.execPath;
const HERE = realpathSync(tmpdir()) as AbsolutePath;
const runner = new BunProcessRunner(process.env);

/** Runs a snippet of JavaScript in a child Bun. */
const script = (code: string, options: { timeoutMs?: number; maxOutputBytes?: number } = {}) =>
  runner.run(
    { command: BUN, args: ["-e", code], cwd: HERE },
    { timeoutMs: options.timeoutMs ?? 10_000, ...options },
  );

describe("BunProcessRunner", () => {
  test("captures stdout, stderr and the exit code; a non-zero exit is an outcome", async () => {
    const result = await script(
      "process.stdout.write('out'); process.stderr.write('err'); process.exit(3)",
    );
    expect(result.ok && result.value).toMatchObject({ exitCode: 3, stdout: "out", stderr: "err" });
    expect(result.ok && result.value.truncated).toBe(false);
  });

  test("passes arguments as they are, with no shell to expand them", async () => {
    const result = await runner.run(
      {
        command: BUN,
        args: ["-e", "console.log(JSON.stringify(process.argv.slice(1)))", "$(whoami)", "a b"],
        cwd: HERE,
      },
      { timeoutMs: 10_000 },
    );
    expect(result.ok && JSON.parse(result.value.stdout)).toEqual(["$(whoami)", "a b"]);
  });

  test("runs in the given directory", async () => {
    const result = await script("console.log(process.cwd())");
    expect(result.ok && realpathSync(result.value.stdout.trim())).toBe(HERE);
  });

  test("a program that is not installed is a process error naming it, without arguments", async () => {
    const result = await runner.run(
      { command: "xuefu-no-such-program", args: ["--secret", "s3cr3t"], cwd: HERE },
      { timeoutMs: 1000 },
    );
    expect(!result.ok && result.error).toMatchObject({
      kind: "process",
      command: "xuefu-no-such-program",
      exitCode: null,
    });
    expect(JSON.stringify(!result.ok && result.error)).not.toContain("s3cr3t");
  });

  test("a program that takes too long is stopped and reported as a timeout", async () => {
    const started = performance.now();
    const result = await script("setTimeout(() => {}, 30_000)", { timeoutMs: 100 });
    expect(!result.ok && result.error).toMatchObject({ kind: "timeout", afterMs: 100 });
    expect(performance.now() - started).toBeLessThan(5000);
  });

  test("an abort stops the program; one aborted before it starts never runs", async () => {
    const controller = new AbortController();
    const running = runner.run(
      { command: BUN, args: ["-e", "setTimeout(() => {}, 30_000)"], cwd: HERE },
      { timeoutMs: 30_000, signal: controller.signal },
    );
    setTimeout(() => controller.abort(), 50);
    expect(await running).toMatchObject({ ok: false, error: { kind: "cancelled" } });

    const before = await runner.run(
      { command: "xuefu-no-such-program", args: [], cwd: HERE },
      { timeoutMs: 1000, signal: AbortSignal.abort() },
    );
    expect(before).toMatchObject({ ok: false, error: { kind: "cancelled" } });
  });

  test("a program that ignores SIGTERM is killed once the grace period ends", async () => {
    const impatient = new BunProcessRunner(process.env, 100);
    const started = performance.now();
    const result = await impatient.run(
      {
        command: BUN,
        args: ["-e", "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)"],
        cwd: HERE,
      },
      { timeoutMs: 200 },
    );
    expect(!result.ok && result.error.kind).toBe("timeout");
    expect(performance.now() - started).toBeLessThan(5000);
  });

  test("keeps the start of stdout up to the limit and the end of stderr", async () => {
    const result = await script(
      "process.stdout.write('a'.repeat(5000) + 'END'); process.stderr.write('x'.repeat(100_000) + 'LAST')",
      { maxOutputBytes: 1000 },
    );
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.stdout).toBe("a".repeat(1000));
    expect(result.value.truncated).toBe(true);
    expect(result.value.stderr.endsWith("LAST")).toBe(true);
    expect(result.value.stderr.length).toBe(64 * 1024);
  });

  test("terminateAll stops children still running", async () => {
    const own = new BunProcessRunner(process.env);
    const running = own.run(
      { command: BUN, args: ["-e", "setTimeout(() => {}, 30_000)"], cwd: HERE },
      { timeoutMs: 30_000 },
    );
    await Bun.sleep(100);
    own.terminateAll();
    const result = await running;
    expect(result.ok && result.value.exitCode).not.toBe(0);
  });
});

describe("childEnvironment", () => {
  test("passes only what tools need, plus LC_* and GIT_*, then the extras", () => {
    const env = childEnvironment(
      {
        PATH: "/bin",
        HOME: "/home/a",
        LC_ALL: "C",
        GIT_SSH_COMMAND: "ssh -i key",
        JIRA_TOKEN: "s3cr3t",
        AWS_SECRET_ACCESS_KEY: "s3cr3t",
        EMPTY: undefined,
      },
      { GIT_OPTIONAL_LOCKS: "0" },
    );
    expect(env).toEqual({
      PATH: "/bin",
      HOME: "/home/a",
      LC_ALL: "C",
      GIT_SSH_COMMAND: "ssh -i key",
      GIT_OPTIONAL_LOCKS: "0",
    });
  });
});
