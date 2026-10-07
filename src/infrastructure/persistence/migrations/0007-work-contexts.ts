import type { Migration } from "./migration";

export const workContexts: Migration = {
  version: 7,
  name: "work-contexts",
  // No foreign key to workspaces: like timers, this is history that outlives a removed workspace.
  sql: `
    CREATE TABLE work_contexts (
      id           TEXT    PRIMARY KEY,
      workspace_id TEXT    NOT NULL,
      issue_key    TEXT    NOT NULL,
      title        TEXT    CHECK (title IS NULL OR length(title) BETWEEN 1 AND 200),
      started_at   INTEGER NOT NULL CHECK (started_at >= 0),
      ended_at     INTEGER CHECK (ended_at IS NULL OR ended_at >= started_at)
    ) STRICT;

    -- One piece of work in progress per workspace.
    CREATE UNIQUE INDEX work_contexts_single_open ON work_contexts (workspace_id)
      WHERE ended_at IS NULL;
  `,
};
