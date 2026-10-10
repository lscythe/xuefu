import { z } from "zod";
import { defineCommand } from "../../src/application/commands/command";
import { CommandBus } from "../../src/application/commands/command-bus";
import type { AppError } from "../../src/application/errors";
import { domainString } from "../../src/application/validation";
import type { StartedWork } from "../../src/application/work/commands";
import { type WorkId, workspaceId } from "../../src/domain/shared/ids";
import { ok, type Result } from "../../src/domain/shared/result";
import type { Timestamp } from "../../src/domain/shared/time";
import { issueKey } from "../../src/domain/work/issue-key";
import { issueTitle, startWork } from "../../src/domain/work/work-context";
import type { CoreCommands, PluginContext } from "../../src/plugins/plugin";
import { fakeSecrets } from "./fake-secrets";
import { ManualClock } from "./manual-clock";
import { SequentialIds } from "./sequential-ids";
import { testLogger } from "./test-logger";

/** What work.start was asked to do. */
export interface StartWorkCall {
  readonly workspace: string;
  readonly issue: string;
  readonly title?: string | undefined;
}

/**
 * The core's commands as plugins see them, with work.start standing in for the real one: it
 * answers `answer`, or that the work started with nothing finished and no timer change.
 */
export function fakeCore(answer?: (call: StartWorkCall) => Result<StartedWork, AppError>) {
  const started: StartWorkCall[] = [];
  const core: CoreCommands = {
    startWork: defineCommand({
      name: "work.start",
      title: "Start work",
      category: "Work",
      safety: "safe",
      input: z.strictObject({
        workspace: domainString(workspaceId),
        issue: domainString(issueKey),
        title: domainString(issueTitle).optional(),
      }),
      handler: (input) => {
        started.push(input);
        if (answer !== undefined) return Promise.resolve(answer(input));
        const work = startWork(
          {
            id: `wrk-${input.issue}` as WorkId,
            workspaceId: input.workspace,
            issueKey: input.issue,
            title: input.title ?? null,
          },
          0 as Timestamp,
        );
        return Promise.resolve(
          ok({ work: { work, workspace: null }, finished: null, timer: null }),
        );
      },
    }),
  };
  return { core, started };
}

/** A plugin's context with a real bus carrying the core's commands; parts can be replaced. */
export function pluginContext(overrides: Partial<PluginContext> = {}): PluginContext & {
  readonly bus: CommandBus;
} {
  const logger = testLogger().logger;
  const clock = new ManualClock();
  const bus = new CommandBus({ logger, clock, ids: new SequentialIds() });
  const { core } = fakeCore();
  bus.register(core.startWork);
  return {
    bus,
    processes: { run: () => Promise.reject(new Error("no programs in this test")) },
    http: { request: () => Promise.reject(new Error("no HTTP in this test")) },
    secrets: fakeSecrets(),
    logger,
    clock,
    core,
    ...overrides,
  } as PluginContext & { readonly bus: CommandBus };
}
