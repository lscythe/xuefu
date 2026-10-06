import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JsonLinesFileSink } from "../../../../src/infrastructure/logging/file-sink";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "xuefu-log-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const record = (msg: string) => ({ time: "2026-10-06T09:00:00.000Z", level: "info" as const, msg });

function open(maxBytes: number, maxFiles = 3) {
  const result = JsonLinesFileSink.open({
    path: join(dir, "logs", "xuefu.log"),
    maxBytes,
    maxFiles,
  });
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

describe("JsonLinesFileSink", () => {
  test("creates the log directory and appends one JSON object per line", () => {
    const sink = open(1_000_000);
    sink.write(record("one"));
    sink.write(record("two"));
    const lines = readFileSync(join(dir, "logs", "xuefu.log"), "utf8")
      .trim()
      .split("\n");
    expect(lines.map((l) => JSON.parse(l).msg)).toEqual(["one", "two"]);
  });

  test("log files are private to the user", () => {
    const sink = open(1_000_000);
    sink.write(record("x"));
    expect(statSync(join(dir, "logs", "xuefu.log")).mode & 0o777).toBe(0o600);
    expect(statSync(join(dir, "logs")).mode & 0o777).toBe(0o700);
  });

  test("rotates when the size limit would be exceeded and keeps at most maxFiles", () => {
    const sink = open(200, 2);
    for (let i = 0; i < 20; i += 1) sink.write(record(`message number ${i}`));
    const base = join(dir, "logs", "xuefu.log");
    expect(existsSync(`${base}.1`)).toBe(true);
    expect(existsSync(`${base}.2`)).toBe(true);
    expect(existsSync(`${base}.3`)).toBe(false);
    const active = readFileSync(base, "utf8");
    expect(Buffer.byteLength(active)).toBeLessThanOrEqual(200);
    const newest = active.trim().split("\n").at(-1) ?? "";
    expect(JSON.parse(newest).msg).toBe("message number 19");
  });

  test("continues appending to an existing file after reopening", () => {
    open(1_000_000).write(record("first run"));
    open(1_000_000).write(record("second run"));
    const lines = readFileSync(join(dir, "logs", "xuefu.log"), "utf8")
      .trim()
      .split("\n");
    expect(lines).toHaveLength(2);
  });

  test("reports a filesystem error when the log directory cannot be created", () => {
    writeFileSync(join(dir, "blocker"), "");
    const result = JsonLinesFileSink.open({
      path: join(dir, "blocker", "logs", "xuefu.log"),
      maxBytes: 100,
      maxFiles: 1,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.operation).toBe("open");
  });

  test("rejects an invalid rotation count", () => {
    const result = JsonLinesFileSink.open({ path: join(dir, "x.log"), maxBytes: 10, maxFiles: 0 });
    expect(result.ok).toBe(false);
  });

  test("rotation tolerates rotated files that are already gone", () => {
    const sink = open(120, 3);
    for (let i = 0; i < 10; i += 1) sink.write(record(`message ${i}`));
    rmSync(join(dir, "logs", "xuefu.log.2"), { force: true });
    expect(() => {
      for (let i = 10; i < 20; i += 1) sink.write(record(`message ${i}`));
    }).not.toThrow();
    const newest = readFileSync(join(dir, "logs", "xuefu.log"), "utf8")
      .trim()
      .split("\n")
      .at(-1);
    expect(JSON.parse(newest ?? "{}").msg).toBe("message 19");
  });

  test("rejects invalid limits", () => {
    const result = JsonLinesFileSink.open({ path: join(dir, "x.log"), maxBytes: 0, maxFiles: 1 });
    expect(result.ok).toBe(false);
  });
});
