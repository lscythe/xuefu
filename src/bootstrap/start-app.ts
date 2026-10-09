import type { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { RECORDED_EVENTS } from "../application/activity/describe";
import { ActivityQueries } from "../application/activity/queries";
import { CommandBus } from "../application/commands/command-bus";
import { EventCatalog } from "../application/events/catalog";
import { EventBus } from "../application/events/event-bus";
import type { Logger } from "../application/ports/logger";
import type { Redactor } from "../application/security/redaction";
import {
  registerTimerCommands,
  type TimerCommands,
  timerCommands,
} from "../application/timesheet/commands";
import { TimerQueries } from "../application/timesheet/queries";
import {
  registerWorkCommands,
  type WorkCommands,
  workCommands,
} from "../application/work/commands";
import { WorkQueries } from "../application/work/queries";
import {
  registerWorkspaceCommands,
  type WorkspaceCommands,
  workspaceCommands,
} from "../application/workspace/commands";
import { WorkspaceQueries } from "../application/workspace/queries";
import {
  type ConfigurationError,
  type FileSystemError,
  fileSystemError,
  type MigrationError,
  type StorageError,
  type UnexpectedError,
  unexpected,
} from "../domain/shared/errors";
import { err, fromThrowable, ok, type Result } from "../domain/shared/result";
import { type ConfigSource, loadConfig } from "../infrastructure/config/load-config";
import { resolvePaths, type XueFuPaths } from "../infrastructure/config/paths";
import { readConfigFile } from "../infrastructure/config/read-config-file";
import type { GlobalConfig } from "../infrastructure/config/schema";
import { fsWorkspaceProbe } from "../infrastructure/filesystem/workspace-probe";
import { JsonLinesFileSink } from "../infrastructure/logging/file-sink";
import { createLogger } from "../infrastructure/logging/logger";
import { MIGRATIONS } from "../infrastructure/persistence/migrations/catalog";
import { type MigrationReport, migrate } from "../infrastructure/persistence/migrations/runner";
import { openDatabase } from "../infrastructure/persistence/sqlite/database";
import { SqliteEventLedger } from "../infrastructure/persistence/sqlite/event-ledger";
import { SqliteTimerRepository } from "../infrastructure/persistence/sqlite/timer-repository";
import { SqliteUnitOfWork } from "../infrastructure/persistence/sqlite/unit-of-work";
import { SqliteWorkContextRepository } from "../infrastructure/persistence/sqlite/work-context-repository";
import { SqliteWorkspaceRepository } from "../infrastructure/persistence/sqlite/workspace-repository";
import { SqliteWorkspaceSessionRepository } from "../infrastructure/persistence/sqlite/workspace-session-repository";
import { SqliteWorkspaceTabsRepository } from "../infrastructure/persistence/sqlite/workspace-tabs-repository";
import { systemClock } from "../infrastructure/system/clock";
import { uuidV7Ids } from "../infrastructure/system/ids";

export type BootError =
  | ConfigurationError
  | FileSystemError
  | StorageError
  | MigrationError
  | UnexpectedError;

export interface StartOptions {
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly home: string;
  readonly version: string;
  readonly overrides: Readonly<Record<string, unknown>>;
  readonly redactor: Redactor;
  /** Where to report a failing log sink; logging itself must never crash XueFu. */
  readonly reportSinkFailure: (message: string) => void;
}

export interface App {
  readonly paths: XueFuPaths;
  readonly config: GlobalConfig;
  readonly configSources: readonly ConfigSource[];
  readonly configFileFound: boolean;
  readonly logger: Logger;
  readonly migration: MigrationReport;
  readonly commandBus: CommandBus;
  readonly eventBus: EventBus;
  readonly unitOfWork: SqliteUnitOfWork;
  readonly ledger: SqliteEventLedger;
  readonly workspaceCommands: WorkspaceCommands;
  readonly workspaces: WorkspaceQueries;
  readonly timerCommands: TimerCommands;
  readonly timers: TimerQueries;
  readonly workCommands: WorkCommands;
  readonly work: WorkQueries;
  readonly activity: ActivityQueries;
  close(): void;
}

function ensurePrivateDir(path: string): Result<void, FileSystemError> {
  return fromThrowable(
    () => {
      mkdirSync(path, { recursive: true, mode: 0o700 });
    },
    (thrown) => fileSystemError("Unable to create directory", path, "mkdir", { cause: thrown }),
  );
}

/** Composition root: the only place that wires concrete adapters to ports. */
export async function startApp(options: StartOptions): Promise<Result<App, BootError>> {
  const paths = resolvePaths({ env: options.env, home: options.home });
  if (!paths.ok) return paths;

  const file = await readConfigFile(paths.value.configFile);
  if (!file.ok) return file;
  const loaded = loadConfig({
    globalFile: file.value,
    env: options.env,
    cli: { ...options.overrides },
  });
  if (!loaded.ok) return loaded;
  const { config, sources } = loaded.value;

  for (const dir of [paths.value.dataDir, paths.value.logDir]) {
    const created = ensurePrivateDir(dir);
    if (!created.ok) return created;
  }

  const sink = JsonLinesFileSink.open({
    path: paths.value.logFile,
    maxBytes: config.logging.maxFileBytes,
    maxFiles: config.logging.maxFiles,
  });
  if (!sink.ok) return sink;

  let sinkFailureReported = false;
  const logger = createLogger({
    level: config.logging.level,
    sinks: [sink.value],
    clock: systemClock,
    redactor: options.redactor,
    onSinkError: (error, sinkName) => {
      if (sinkFailureReported) return;
      sinkFailureReported = true;
      options.reportSinkFailure(`warning: log sink "${sinkName}" failed: ${String(error)}`);
    },
  });

  const db = openDatabase(paths.value.databaseFile);
  if (!db.ok) return db;
  const migration = migrate(db.value, MIGRATIONS, {
    clock: systemClock,
    backupDir: paths.value.backupDir,
  });
  if (!migration.ok) {
    logger.error("Database migration failed", { error: migration.error });
    db.value.close();
    return err(migration.error);
  }

  const database: Database = db.value;
  const eventBus = new EventBus(logger);
  const ledger = new SqliteEventLedger(database);
  const unitOfWork = new SqliteUnitOfWork(database, ledger, eventBus);
  const commandBus = new CommandBus({ logger, clock: systemClock, ids: uuidV7Ids });

  const workspaceRepository = new SqliteWorkspaceRepository(database);
  const tabRepository = new SqliteWorkspaceTabsRepository(database);
  const sessionRepository = new SqliteWorkspaceSessionRepository(database);
  const workspaces = workspaceCommands({
    repository: workspaceRepository,
    tabs: tabRepository,
    sessions: sessionRepository,
    probe: fsWorkspaceProbe,
    unitOfWork,
    ids: uuidV7Ids,
  });
  const timerRepository = new SqliteTimerRepository(database);
  const timers = timerCommands({
    timers: timerRepository,
    workspaces: workspaceRepository,
    unitOfWork,
    ids: uuidV7Ids,
  });
  const workRepository = new SqliteWorkContextRepository(database);
  const work = workCommands({
    contexts: workRepository,
    timers: timerRepository,
    workspaces: workspaceRepository,
    unitOfWork,
    ids: uuidV7Ids,
  });
  const registered = [
    () => registerWorkspaceCommands(commandBus, workspaces),
    () => registerTimerCommands(commandBus, timers),
    () => registerWorkCommands(commandBus, work),
  ].reduce<ReturnType<typeof registerWorkCommands>>(
    (result, next) => (result.ok ? next() : result),
    ok(undefined),
  );
  // Duplicate command names or event definitions are wiring mistakes, caught here at startup.
  const catalog = registered.ok ? EventCatalog.create(RECORDED_EVENTS) : registered;
  if (!catalog.ok) {
    database.close();
    return err(unexpected("XueFu is wired incorrectly", new Error(catalog.error.message)));
  }

  logger.info("XueFu started", {
    version: options.version,
    pid: process.pid,
    logLevel: config.logging.level,
    schemaVersion: migration.value.toVersion,
    migrationsApplied: migration.value.applied,
  });

  return ok({
    paths: paths.value,
    config,
    configSources: sources,
    configFileFound: file.value.text !== null,
    logger,
    migration: migration.value,
    commandBus,
    eventBus,
    unitOfWork,
    ledger,
    workspaceCommands: workspaces,
    workspaces: new WorkspaceQueries(
      workspaceRepository,
      fsWorkspaceProbe,
      tabRepository,
      sessionRepository,
    ),
    timerCommands: timers,
    timers: new TimerQueries(timerRepository, workspaceRepository),
    workCommands: work,
    work: new WorkQueries(workRepository, workspaceRepository),
    activity: new ActivityQueries(ledger, workspaceRepository, catalog.value),
    close: () => {
      logger.debug("XueFu stopping");
      database.close();
    },
  });
}
