import type { StorageError, ValidationError } from "../../domain/shared/errors";
import type { WorkspaceId } from "../../domain/shared/ids";
import { ok, type Result } from "../../domain/shared/result";
import type { Timestamp } from "../../domain/shared/time";
import type { Workspace } from "../../domain/workspace/workspace";
import type { EventCatalog } from "../events/catalog";
import type { EventLedger } from "../ports/event-ledger";
import type { WorkspaceRepository } from "../ports/workspace-repository";
import { type ActivityDescription, describeEvent } from "./describe";

/** One thing that happened, in words, with the workspace it happened in. */
interface ActivityEntry {
  readonly seq: number;
  readonly at: Timestamp;
  readonly workspaceId: WorkspaceId | null;
  /** Null when the event belongs to no workspace or the workspace has since been removed. */
  readonly workspace: Workspace | null;
  readonly description: ActivityDescription;
}

export interface ActivityPage {
  readonly entries: readonly ActivityEntry[];
  /** Pass as `before` for the next, older page; null when there is none. */
  readonly nextCursor: number | null;
}

export interface ActivityQuery {
  readonly workspaceId?: WorkspaceId;
  readonly before?: number;
  readonly limit: number;
}

/** The activity ledger read back as a timeline. */
export class ActivityQueries {
  constructor(
    private readonly ledger: EventLedger,
    private readonly workspaces: WorkspaceRepository,
    private readonly catalog: EventCatalog,
  ) {}

  /** The latest entries first. */
  recent(query: ActivityQuery): Result<ActivityPage, StorageError | ValidationError> {
    const page = this.ledger.list({
      limit: query.limit,
      newestFirst: true,
      ...(query.workspaceId === undefined ? {} : { workspaceId: query.workspaceId }),
      ...(query.before === undefined ? {} : { beforeSeq: query.before }),
    });
    if (!page.ok) return page;
    const registry = this.workspaces.load();
    if (!registry.ok) return registry;
    const byId = new Map(registry.value.workspaces.map((w) => [w.id, w]));
    return ok({
      entries: page.value.events.map((event) => ({
        seq: event.seq,
        at: event.occurredAt,
        workspaceId: event.workspaceId,
        workspace: event.workspaceId === null ? null : (byId.get(event.workspaceId) ?? null),
        description: describeEvent(event, this.catalog),
      })),
      nextCursor: page.value.nextCursor,
    });
  }
}
