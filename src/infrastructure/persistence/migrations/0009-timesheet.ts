import type { Migration } from "./migration";

export const timesheet: Migration = {
  version: 9,
  name: "timesheet",
  // No foreign key to workspaces: tracked time is history and outlives a removed workspace. An
  // entry is on one workspace, or on a whole group (a group is a name its workspaces share).
  sql: `
    CREATE TABLE time_entries (
      id           TEXT    PRIMARY KEY,
      workspace_id TEXT,
      group_name   TEXT    CHECK (group_name IS NULL OR length(group_name) BETWEEN 1 AND 32),
      issue_key    TEXT,
      category     TEXT    CHECK (category IS NULL OR length(category) BETWEEN 1 AND 40),
      start_at     INTEGER NOT NULL CHECK (start_at >= 0),
      end_at       INTEGER NOT NULL CHECK (end_at > start_at),
      note         TEXT    CHECK (note IS NULL OR length(note) BETWEEN 1 AND 2000),
      CHECK ((issue_key IS NULL) <> (category IS NULL)),
      CHECK ((workspace_id IS NULL) <> (group_name IS NULL))
    ) STRICT;

    CREATE INDEX time_entries_by_start ON time_entries (start_at);

    -- What a timesheet says of a day beyond the time tracked; a day saying nothing is deleted.
    -- The timesheet is a group's ("group:<name>"), or a workspace's in no group ("workspace:<id>").
    CREATE TABLE timesheet_days (
      scope      TEXT    NOT NULL CHECK (scope GLOB 'group:?*' OR scope GLOB 'workspace:?*'),
      day        TEXT    NOT NULL
                         CHECK (day GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
      place      TEXT    CHECK (place IS NULL OR length(place) BETWEEN 1 AND 80),
      leave      INTEGER NOT NULL CHECK (leave IN (0, 1)),
      tasks      TEXT    CHECK (tasks IS NULL OR length(tasks) BETWEEN 1 AND 2000),
      updated_at INTEGER NOT NULL CHECK (updated_at >= 0),
      PRIMARY KEY (scope, day)
    ) STRICT;
  `,
};
