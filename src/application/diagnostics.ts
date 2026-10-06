/** Everything `xuefu diagnostics` reports. Contains paths and settings, never secret values. */
export interface DiagnosticsReport {
  readonly version: string;
  readonly runtime: { readonly bun: string; readonly platform: string; readonly arch: string };
  readonly paths: {
    readonly configFile: string;
    readonly dataDir: string;
    readonly databaseFile: string;
    readonly backupDir: string;
    readonly logFile: string;
  };
  readonly config: {
    readonly fileFound: boolean;
    readonly sources: readonly string[];
    readonly logLevel: string;
    readonly icons: string;
    readonly telemetry: boolean;
  };
  readonly database: {
    readonly schemaVersion: number;
    readonly migrationsAppliedNow: readonly number[];
    readonly backupPath: string | null;
  };
}
