import type { Migration } from "./migration";

export const workspaceTabs: Migration = {
  version: 4,
  name: "workspace-tabs",
  sql: `
    CREATE TABLE workspace_tabs (
      workspace_id TEXT    PRIMARY KEY REFERENCES workspaces (id) ON DELETE CASCADE,
      position     INTEGER NOT NULL UNIQUE CHECK (position BETWEEN 0 AND 8)
    ) STRICT;

    -- Earlier versions reopened the last active workspace; keep doing that as the first tab.
    INSERT INTO workspace_tabs (workspace_id, position)
      SELECT id, 0 FROM workspaces
      WHERE last_active_at IS NOT NULL
      ORDER BY last_active_at DESC
      LIMIT 1;
  `,
};
