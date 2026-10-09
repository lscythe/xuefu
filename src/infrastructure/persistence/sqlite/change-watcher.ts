import type { Database } from "bun:sqlite";
import type { Logger } from "../../../application/ports/logger";
import { describeCause } from "../../../domain/shared/errors";

/**
 * Notices data committed by other processes, such as a CLI command run while the cockpit is open.
 * SQLite's data_version moves only for other connections' commits, so changes made through this
 * connection, which their caller already knows about, are not reported.
 */
export class SqliteChangeWatcher {
  constructor(
    private readonly db: Database,
    private readonly logger: Logger,
  ) {}

  /** Checks every `intervalMs` and calls `listener` after each outside change; returns how to stop. */
  watch(listener: () => void, intervalMs: number): () => void {
    let version: () => number;
    let seen: number;
    try {
      const query = this.db.query<{ data_version: number }, []>("PRAGMA data_version");
      version = () => query.get()?.data_version ?? 0;
      seen = version();
    } catch (thrown) {
      this.logger.warn("Stopped watching for changes", { error: describeCause(thrown) });
      return () => undefined;
    }
    const timer = setInterval(() => {
      let now: number;
      try {
        now = version();
      } catch (thrown) {
        clearInterval(timer);
        this.logger.warn("Stopped watching for changes", { error: describeCause(thrown) });
        return;
      }
      if (now === seen) return;
      seen = now;
      listener();
    }, intervalMs);
    return () => clearInterval(timer);
  }
}
