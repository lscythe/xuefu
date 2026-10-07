import { z } from "zod";
import { defineEvent, type EventDefinition } from "../events/catalog";

const WorkStartedV1 = defineEvent(
  "WorkStarted",
  1,
  z.strictObject({
    workId: z.string(),
    workspaceId: z.string(),
    issueKey: z.string(),
    title: z.string().nullable(),
  }),
);

const WorkStoppedV1 = defineEvent(
  "WorkStopped",
  1,
  z.strictObject({ workId: z.string(), issueKey: z.string() }),
);

export type WorkStartedPayload = z.infer<typeof WorkStartedV1.schema>;
export type WorkStoppedPayload = z.infer<typeof WorkStoppedV1.schema>;

export const WORK_EVENTS: readonly EventDefinition[] = [WorkStartedV1, WorkStoppedV1];
