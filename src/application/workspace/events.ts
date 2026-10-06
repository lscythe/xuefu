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

export type WorkspaceAddedPayload = z.infer<typeof WorkspaceAddedV1.schema>;
export type WorkspaceRemovedPayload = z.infer<typeof WorkspaceRemovedV1.schema>;
export type WorkspaceGroupAssignedPayload = z.infer<typeof WorkspaceGroupAssignedV1.schema>;

export const WORKSPACE_EVENTS: readonly EventDefinition[] = [
  WorkspaceAddedV1,
  WorkspaceRemovedV1,
  WorkspaceGroupAssignedV1,
];
