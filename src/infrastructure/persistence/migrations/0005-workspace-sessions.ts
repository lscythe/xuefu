import type { Migration } from "./migration";

export const workspaceSessions: Migration = {
  version: 5,
  name: "workspace-sessions",
  sql: `
    CREATE TABLE workspace_sessions (
      workspace_id TEXT    PRIMARY KEY REFERENCES workspaces (id) ON DELETE CASCADE,
      navigation   TEXT    NOT NULL CHECK (length(navigation) BETWEEN 1 AND 32),
      updated_at   INTEGER NOT NULL CHECK (updated_at >= 0)
    ) STRICT;
  `,
};
