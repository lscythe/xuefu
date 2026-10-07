import { z } from "zod";
import { defineEvent, type EventDefinition } from "../events/catalog";

const WorkspaceAddedV1 = defineEvent(
  "WorkspaceAdded",
  1,
  z.strictObject({
    id: z.string(),
    name: z.string(),
    path: z.string(),
    group: z.string().nullable(),
  }),
);

const WorkspaceRemovedV1 = defineEvent(
  "WorkspaceRemoved",
  1,
  z.strictObject({ id: z.string(), name: z.string(), path: z.string() }),
);

const WorkspaceGroupAssignedV1 = defineEvent(
  "WorkspaceGroupAssigned",
  1,
  z.strictObject({ id: z.string(), group: z.string().nullable() }),
);

/** The workspace was opened in the cockpit; drives "reopen where I left off". */
const WorkspaceActivatedV1 = defineEvent(
  "WorkspaceActivated",
  1,
  z.strictObject({ id: z.string() }),
);

export type WorkspaceAddedPayload = z.infer<typeof WorkspaceAddedV1.schema>;
export type WorkspaceRemovedPayload = z.infer<typeof WorkspaceRemovedV1.schema>;
export type WorkspaceGroupAssignedPayload = z.infer<typeof WorkspaceGroupAssignedV1.schema>;
export type WorkspaceActivatedPayload = z.infer<typeof WorkspaceActivatedV1.schema>;

export const WORKSPACE_EVENTS: readonly EventDefinition[] = [
  WorkspaceAddedV1,
  WorkspaceRemovedV1,
  WorkspaceGroupAssignedV1,
  WorkspaceActivatedV1,
];
