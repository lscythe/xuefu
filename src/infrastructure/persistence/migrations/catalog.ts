import { activityLedger } from "./0001-activity-ledger";
import { workspaces } from "./0002-workspaces";
import type { Migration } from "./migration";

/** Every schema migration, in order. Append only; never edit or reorder an entry once released. */
export const MIGRATIONS: readonly Migration[] = [activityLedger, workspaces];
