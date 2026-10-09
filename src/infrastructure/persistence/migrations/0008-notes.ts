import type { Migration } from "./migration";

export const notes: Migration = {
  version: 8,
  name: "notes",
  // No foreign key to workspaces: notes, like work, outlive a removed workspace.
  sql: `
    CREATE TABLE notes (
      id           TEXT    PRIMARY KEY,
      workspace_id TEXT    NOT NULL,
      issue_key    TEXT,
      body         TEXT    NOT NULL CHECK (length(body) BETWEEN 1 AND 20000),
      updated_at   INTEGER NOT NULL CHECK (updated_at >= 0)
    ) STRICT;

    -- One note per workspace and issue; a workspace's own note has no issue.
    CREATE UNIQUE INDEX notes_one_per_subject ON notes (workspace_id, coalesce(issue_key, ''));
  `,
};
