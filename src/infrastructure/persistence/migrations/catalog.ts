import { activityLedger } from "./0001-activity-ledger";
import { workspaces } from "./0002-workspaces";
import { workspaceActivity } from "./0003-workspace-activity";
import { workspaceTabs } from "./0004-workspace-tabs";
import { workspaceSessions } from "./0005-workspace-sessions";
import { timers } from "./0006-timers";
import { workContexts } from "./0007-work-contexts";
import { notes } from "./0008-notes";
import type { Migration } from "./migration";

/** Every schema migration, in order. Append only; never edit or reorder an entry once released. */
export const MIGRATIONS: readonly Migration[] = [
  activityLedger,
  workspaces,
  workspaceActivity,
  workspaceTabs,
  workspaceSessions,
  timers,
  workContexts,
  notes,
];
