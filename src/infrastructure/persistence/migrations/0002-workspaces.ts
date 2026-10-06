import type { Migration } from "./migration";

export const workspaces: Migration = {
  version: 2,
  name: "workspaces",
  sql: `
    CREATE TABLE workspaces (
      id         TEXT    PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 64),
      name       TEXT    NOT NULL CHECK (length(name) > 0),
      path       TEXT    NOT NULL UNIQUE CHECK (substr(path, 1, 1) = '/'),
      group_name TEXT    CHECK (group_name IS NULL OR length(group_name) > 0),
      position   INTEGER NOT NULL CHECK (position >= 0),
      added_at   INTEGER NOT NULL CHECK (added_at >= 0)
    ) STRICT;
  `,
};
