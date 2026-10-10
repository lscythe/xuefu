import type { Database } from "bun:sqlite";
import { z } from "zod";
import type { TimerRepository } from "../../../application/ports/timer-repository";
import { type StorageError, storageError } from "../../../domain/shared/errors";
import { timerId, workspaceId } from "../../../domain/shared/ids";
import { err, ok, type Result } from "../../../domain/shared/result";
import { type Timestamp, timestamp } from "../../../domain/shared/time";
import { restoreTimer, type Timer, type TimerSegment } from "../../../domain/timesheet/timer";
import type { TrackedSpan } from "../../../domain/timesheet/tracked";
import { issueKey } from "../../../domain/work/issue-key";

const TimerRowSchema = z.object({
  id: z.string(),
  workspace_id: z.string(),
  issue_key: z.string().nullable(),
  status: z.enum(["running", "paused", "stopped"]),
  started_at: z.number(),
  updated_at: z.number(),
});

const SegmentRowSchema = z.object({ start_at: z.number(), end_at: z.number().nullable() });

const TrackedRowSchema = SegmentRowSchema.extend({
  workspace_id: z.string(),
  issue_key: z.string().nullable(),
});

type TimerRow = z.infer<typeof TimerRowSchema>;

const corrupt = () => storageError("A stored timer is corrupt", "timers.read");

function toTimestamp(epochMs: number): Timestamp | null {
  const parsed = timestamp(epochMs);
  return parsed.ok ? parsed.value : null;
}

function toTimer(row: TimerRow, rawSegments: readonly unknown[]): Result<Timer, StorageError> {
  const segments: TimerSegment[] = [];
  for (const raw of rawSegments) {
    const segment = SegmentRowSchema.safeParse(raw);
    if (!segment.success) return err(corrupt());
    const start = toTimestamp(segment.data.start_at);
    const end = segment.data.end_at === null ? null : toTimestamp(segment.data.end_at);
    if (start === null || (segment.data.end_at !== null && end === null)) return err(corrupt());
    segments.push({ start, end });
  }
  const id = timerId(row.id);
  const workspace = workspaceId(row.workspace_id);
  const issue = row.issue_key === null ? ok(null) : issueKey(row.issue_key);
  const startedAt = toTimestamp(row.started_at);
  const updatedAt = toTimestamp(row.updated_at);
  if (!id.ok || !workspace.ok || !issue.ok || startedAt === null || updatedAt === null) {
    return err(corrupt());
  }
  const restored = restoreTimer({
    id: id.value,
    workspaceId: workspace.value,
    issueKey: issue.value,
    status: row.status,
    startedAt,
    updatedAt,
    segments,
  });
  return restored.ok ? restored : err(corrupt());
}

export class SqliteTimerRepository implements TimerRepository {
  constructor(private readonly db: Database) {}

  active(): Result<Timer | null, StorageError> {
    try {
      const row = this.db
        .query(
          `SELECT id, workspace_id, issue_key, status, started_at, updated_at
           FROM timers WHERE status <> 'stopped'`,
        )
        .get();
      if (row === null) return ok(null);
      const parsed = TimerRowSchema.safeParse(row);
      if (!parsed.success) return err(corrupt());
      const segments = this.db
        .query("SELECT start_at, end_at FROM timer_segments WHERE timer_id = ? ORDER BY position")
        .all(parsed.data.id);
      return toTimer(parsed.data, segments);
    } catch (thrown) {
      return err(storageError("Unable to read the timer", "timers.read", { cause: thrown }));
    }
  }

  save(timer: Timer): Result<void, StorageError> {
    try {
      // A savepoint inside a unit of work, so the outer rollback still applies.
      this.db.transaction(() => {
        this.db
          .query(
            `INSERT INTO timers (id, workspace_id, issue_key, status, started_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?)
             ON CONFLICT (id) DO UPDATE SET
               issue_key = excluded.issue_key,
               status = excluded.status,
               updated_at = excluded.updated_at`,
          )
          .run(
            timer.id,
            timer.workspaceId,
            timer.issueKey,
            timer.status,
            timer.startedAt,
            timer.updatedAt,
          );
        this.db.run("DELETE FROM timer_segments WHERE timer_id = ?", [timer.id]);
        const insert = this.db.query(
          "INSERT INTO timer_segments (timer_id, position, start_at, end_at) VALUES (?, ?, ?, ?)",
        );
        timer.segments.forEach((segment, position) => {
          insert.run(timer.id, position, segment.start, segment.end);
        });
      })();
      return ok(undefined);
    } catch (thrown) {
      return err(storageError("Unable to save the timer", "timers.save", { cause: thrown }));
    }
  }

  trackedSince(since: Timestamp): Result<TrackedSpan[], StorageError> {
    try {
      const rows = this.db
        .query(
          `SELECT t.workspace_id, t.issue_key, s.start_at, s.end_at
           FROM timer_segments s JOIN timers t ON t.id = s.timer_id
           WHERE s.end_at IS NULL OR s.end_at > ?
           ORDER BY s.start_at`,
        )
        .all(since);
      const spans: TrackedSpan[] = [];
      for (const raw of rows) {
        const row = TrackedRowSchema.safeParse(raw);
        if (!row.success) return err(corrupt());
        const workspace = workspaceId(row.data.workspace_id);
        const issue = row.data.issue_key === null ? ok(null) : issueKey(row.data.issue_key);
        const start = toTimestamp(row.data.start_at);
        const end = row.data.end_at === null ? null : toTimestamp(row.data.end_at);
        if (
          !workspace.ok ||
          !issue.ok ||
          start === null ||
          (row.data.end_at !== null && end === null)
        ) {
          return err(corrupt());
        }
        spans.push({ workspaceId: workspace.value, issueKey: issue.value, start, end });
      }
      return ok(spans);
    } catch (thrown) {
      return err(storageError("Unable to read tracked time", "timers.read", { cause: thrown }));
    }
  }
}
