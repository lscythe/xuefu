import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { confirmationTokenFor, defineCommand } from "../../../../src/application/commands/command";
import { CommandBus } from "../../../../src/application/commands/command-bus";
import type { AppError } from "../../../../src/application/errors";
import { validationError } from "../../../../src/domain/shared/errors";
import type { CorrelationId } from "../../../../src/domain/shared/ids";
import { err, ok, type Result } from "../../../../src/domain/shared/result";
import { ManualClock } from "../../../support/manual-clock";
import { SequentialIds } from "../../../support/sequential-ids";
import { testLogger } from "../../../support/test-logger";

function setup() {
  const { logger, sink } = testLogger();
  const bus = new CommandBus({ logger, clock: new ManualClock(), ids: new SequentialIds() });
  return { bus, sink };
}

const status = defineCommand({
  name: "git.status",
  title: "Git status",
  category: "Git",
  safety: "safe",
  input: z.object({ includeUntracked: z.boolean().default(true) }),
  handler: async (input, ctx) =>
    ok({ includeUntracked: input.includeUntracked, correlationId: ctx.correlationId }),
});

const forcePush = defineCommand({
  name: "git.push.force",
  title: "Force push",
  category: "Git",
  safety: "destructive",
  input: z.object({ remote: z.string().min(1), branch: z.string().min(1) }),
  describe: (input) => ({
    title: "Force push",
    severity: "destructive",
    details: [
      { label: "Branch", value: input.branch },
      { label: "Remote", value: input.remote },
    ],
    consequence: "This may overwrite remote history.",
    confirmLabel: "Force Push",
  }),
  handler: async (input) => ok(`pushed ${input.branch}`),
});

function registered(...defs: Parameters<CommandBus["register"]>[0][]) {
  const ctx = setup();
  for (const def of defs) {
    const result = ctx.bus.register(def);
    if (!result.ok) throw new Error(result.error.message);
  }
  return ctx;
}

const expectErrorKind = (result: Result<unknown, AppError>, kind: AppError["kind"]) => {
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.error.kind).toBe(kind);
  return result.ok ? undefined : result.error;
};

describe("CommandBus: registration", () => {
  test("lists registered commands with their metadata, sorted by name", () => {
    const { bus } = registered(status, forcePush);
    expect(bus.list()).toEqual([
      { name: "git.push.force", title: "Force push", category: "Git", safety: "destructive" },
      { name: "git.status", title: "Git status", category: "Git", safety: "safe" },
    ]);
  });

  test("rejects duplicate registrations", () => {
    const { bus } = registered(status);
    const result = bus.register(status);
    expect(!result.ok && result.error.kind).toBe("duplicate-command");
  });

  test.each(["Git.Status", "status", "git..status", "git.status.", "git status"])(
    "rejects malformed command name %p",
    (name) => {
      const { bus } = setup();
      const result = bus.register({ ...status, name });
      expect(!result.ok && result.error.kind).toBe("validation");
    },
  );
});

describe("CommandBus: dispatch", () => {
  test("unknown commands fail explicitly", async () => {
    const { bus } = setup();
    expectErrorKind(await bus.dispatch("nope.nothing", {}), "command-not-found");
  });

  test("validates input before the handler runs and applies schema defaults", async () => {
    const { bus } = registered(status);
    const invalid = expectErrorKind(
      await bus.dispatch("git.status", { includeUntracked: "yes" }),
      "validation",
    );
    expect(invalid?.kind === "validation" && invalid.issues[0]?.path).toBe("includeUntracked");
    const result = await bus.dispatch("git.status", {});
    expect(result.ok && result.value).toMatchObject({ includeUntracked: true });
  });

  test("generates a correlation id per dispatch, or uses the caller's", async () => {
    const { bus } = registered(status);
    const generated = await bus.dispatch("git.status", {});
    expect(generated.ok && generated.value).toMatchObject({ correlationId: "corr-1" });
    const provided = await bus.dispatch(
      "git.status",
      {},
      { correlationId: "flow-7" as CorrelationId },
    );
    expect(provided.ok && provided.value).toMatchObject({ correlationId: "flow-7" });
  });

  test("logs start and finish with correlation id and duration, never the input", async () => {
    const { bus, sink } = registered(forcePush);
    const first = await bus.dispatch("git.push.force", {
      remote: "origin",
      branch: "secret-branch",
    });
    const token =
      !first.ok && first.error.kind === "confirmation-required"
        ? confirmationTokenFor(first.error)
        : undefined;
    await bus.dispatch(
      "git.push.force",
      { remote: "origin", branch: "secret-branch" },
      {
        ...(token === undefined ? {} : { confirmation: token }),
      },
    );
    const records = sink.records().filter((r) => r["command"] === "git.push.force");
    expect(
      records.some((r) => r.msg === "Command succeeded" && typeof r["durationMs"] === "number"),
    ).toBe(true);
    expect(records.every((r) => typeof r["correlationId"] === "string")).toBe(true);
    expect(JSON.stringify(sink.records())).not.toContain("secret-branch");
  });

  test("handler errors are returned unchanged", async () => {
    const failing = defineCommand({
      ...status,
      name: "git.fail",
      handler: async () => err(validationError("bad state", [])),
    });
    const { bus } = registered(failing);
    const error = expectErrorKind(await bus.dispatch("git.fail", {}), "validation");
    expect(error?.message).toBe("bad state");
  });

  test("a throwing handler becomes an unexpected error and is logged", async () => {
    const crashing = defineCommand({
      ...status,
      name: "git.crash",
      handler: () => Promise.reject(new Error("kaboom")),
    });
    const { bus, sink } = registered(crashing);
    const error = expectErrorKind(await bus.dispatch("git.crash", {}), "unexpected");
    expect(error?.cause).toEqual({ name: "Error", message: "kaboom" });
    expect(sink.records().some((r) => r.level === "error" && r["command"] === "git.crash")).toBe(
      true,
    );
  });
});

describe("CommandBus: invoke", () => {
  test("runs a registered definition through the same pipeline with typed output", async () => {
    const { bus } = registered(status);
    const result = await bus.invoke(status, {});
    if (!result.ok) throw new Error(result.error.message);
    const flag: boolean = result.value.includeUntracked;
    expect(flag).toBe(true);
    expectErrorKind(await bus.invoke(status, { includeUntracked: "yes" }), "validation");
  });

  test("still enforces confirmation", async () => {
    const { bus } = registered(forcePush);
    const input = { remote: "origin", branch: "main" };
    const first = expectErrorKind(await bus.invoke(forcePush, input), "confirmation-required");
    if (first?.kind !== "confirmation-required") return;
    const confirmed = await bus.invoke(forcePush, input, {
      confirmation: confirmationTokenFor(first),
    });
    expect(confirmed).toEqual({ ok: true, value: "pushed main" });
  });

  test("a definition that is not the registered one is not found", async () => {
    const { bus } = registered(status);
    const impostor = defineCommand({ ...status, handler: async () => ok({ hijacked: true }) });
    expectErrorKind(await bus.invoke(impostor, {}), "command-not-found");
  });
});

describe("CommandBus: confirmation gate", () => {
  const input = { remote: "origin", branch: "feature/MOB-2841" };

  test("invariant: destructive commands never run without confirmation", async () => {
    let ran = false;
    const { bus } = registered({
      ...forcePush,
      handler: () => {
        ran = true;
        return Promise.resolve(ok("pushed"));
      },
    });
    const error = expectErrorKind(
      await bus.dispatch("git.push.force", input),
      "confirmation-required",
    );
    expect(ran).toBe(false);
    if (error?.kind === "confirmation-required") {
      expect(error.prompt.details).toContainEqual({ label: "Branch", value: "feature/MOB-2841" });
      expect(error.prompt.severity).toBe("destructive");
    }
  });

  test("a matching confirmation token allows execution", async () => {
    const { bus } = registered(forcePush);
    const first = await bus.dispatch("git.push.force", input);
    if (first.ok || first.error.kind !== "confirmation-required")
      throw new Error("expected prompt");
    const confirmed = await bus.dispatch("git.push.force", input, {
      confirmation: confirmationTokenFor(first.error),
    });
    expect(confirmed).toEqual(ok("pushed feature/MOB-2841"));
  });

  test("a token approved for one input cannot be replayed for another", async () => {
    const { bus } = registered(forcePush);
    const first = await bus.dispatch("git.push.force", input);
    if (first.ok || first.error.kind !== "confirmation-required")
      throw new Error("expected prompt");
    const token = confirmationTokenFor(first.error);
    expectErrorKind(
      await bus.dispatch("git.push.force", { ...input, branch: "main" }, { confirmation: token }),
      "confirmation-required",
    );
  });

  test("a token for a different command is rejected", async () => {
    const { bus } = registered(forcePush);
    expectErrorKind(
      await bus.dispatch("git.push.force", input, {
        confirmation: { command: "git.branch.delete", inputDigest: "{}" },
      }),
      "confirmation-required",
    );
  });

  test("key order of the input does not affect token matching", async () => {
    const { bus } = registered(forcePush);
    const first = await bus.dispatch("git.push.force", input);
    if (first.ok || first.error.kind !== "confirmation-required")
      throw new Error("expected prompt");
    const reordered = { branch: input.branch, remote: input.remote };
    const result = await bus.dispatch("git.push.force", reordered, {
      confirmation: confirmationTokenFor(first.error),
    });
    expect(result.ok).toBe(true);
  });
});

describe("CommandBus: cancellation and timeouts", () => {
  const slow = (ms: number, timeoutMs?: number) =>
    defineCommand({
      name: "build.slow",
      title: "Slow",
      category: "Build",
      safety: "safe",
      input: z.object({}),
      ...(timeoutMs === undefined ? {} : { timeoutMs }),
      handler: async (_input, ctx) => {
        await Bun.sleep(ms);
        return ok(ctx.signal.aborted ? "saw-abort" : "done");
      },
    });

  test("an already-aborted signal cancels before the handler runs", async () => {
    let ran = false;
    const { bus } = registered({
      ...slow(0),
      handler: () => {
        ran = true;
        return Promise.resolve(ok("x"));
      },
    });
    const controller = new AbortController();
    controller.abort();
    expectErrorKind(
      await bus.dispatch("build.slow", {}, { signal: controller.signal }),
      "cancelled",
    );
    expect(ran).toBe(false);
  });

  test("aborting during execution resolves as cancelled and signals the handler", async () => {
    let handlerSignal: AbortSignal | undefined;
    const { bus } = registered({
      ...slow(0),
      handler: async (_input, ctx) => {
        handlerSignal = ctx.signal;
        await Bun.sleep(100);
        return ok("late");
      },
    });
    const controller = new AbortController();
    const pending = bus.dispatch("build.slow", {}, { signal: controller.signal });
    setTimeout(() => controller.abort(), 5);
    expectErrorKind(await pending, "cancelled");
    expect(handlerSignal?.aborted).toBe(true);
  });

  test("exceeding the command timeout yields a timeout error", async () => {
    const { bus } = registered(slow(200, 10));
    const error = expectErrorKind(await bus.dispatch("build.slow", {}), "timeout");
    expect(error?.kind === "timeout" && error.afterMs).toBe(10);
  });

  test("fast commands are unaffected by the timeout", async () => {
    const { bus } = registered(slow(0, 1_000));
    expect(await bus.dispatch("build.slow", {})).toEqual(ok("done"));
  });
});
