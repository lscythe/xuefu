import type { Migration } from "./migration";

export const activityLedger: Migration = {
  version: 1,
  name: "activity ledger",
  sql: `
    CREATE TABLE events (
      seq            INTEGER PRIMARY KEY AUTOINCREMENT,
      id             TEXT    NOT NULL UNIQUE,
      type           TEXT    NOT NULL CHECK (length(type) > 0),
      version        INTEGER NOT NULL CHECK (version >= 1),
      occurred_at    INTEGER NOT NULL CHECK (occurred_at >= 0),
      workspace_id   TEXT,
      correlation_id TEXT    NOT NULL,
      payload        TEXT    NOT NULL CHECK (json_valid(payload))
    ) STRICT;

    CREATE INDEX events_by_workspace_time ON events (workspace_id, occurred_at);
    CREATE INDEX events_by_time ON events (occurred_at);

    CREATE TRIGGER events_no_update BEFORE UPDATE ON events
    BEGIN SELECT RAISE(ABORT, 'events are append-only'); END;

    CREATE TRIGGER events_no_delete BEFORE DELETE ON events
    BEGIN SELECT RAISE(ABORT, 'events are append-only'); END;
  `,
};
