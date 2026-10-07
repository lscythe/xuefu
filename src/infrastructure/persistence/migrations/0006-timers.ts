import type { Migration } from "./migration";

export const timers: Migration = {
  version: 6,
  name: "timers",
  // No foreign key to workspaces: tracked time is history and outlives a removed workspace.
  sql: `
    CREATE TABLE timers (
      id           TEXT    PRIMARY KEY,
      workspace_id TEXT    NOT NULL,
      issue_key    TEXT,
      status       TEXT    NOT NULL CHECK (status IN ('running', 'paused', 'stopped')),
      started_at   INTEGER NOT NULL CHECK (started_at >= 0),
      updated_at   INTEGER NOT NULL CHECK (updated_at >= started_at)
    ) STRICT;

    -- At most one timer is running or paused, across every workspace and process.
    CREATE UNIQUE INDEX timers_single_active ON timers ((status <> 'stopped'))
      WHERE status <> 'stopped';

    CREATE TABLE timer_segments (
      timer_id TEXT    NOT NULL REFERENCES timers (id) ON DELETE CASCADE,
      position INTEGER NOT NULL CHECK (position >= 0),
      start_at INTEGER NOT NULL CHECK (start_at >= 0),
      end_at   INTEGER CHECK (end_at IS NULL OR end_at >= start_at),
      PRIMARY KEY (timer_id, position)
    ) STRICT;
  `,
};
