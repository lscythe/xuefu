import type { Migration } from "./migration";

export const workspaceActivity: Migration = {
  version: 3,
  name: "workspace-activity",
  sql: `
    ALTER TABLE workspaces
      ADD COLUMN last_active_at INTEGER CHECK (last_active_at IS NULL OR last_active_at >= 0);
  `,
};
