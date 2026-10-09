import { z } from "zod";
import { defineEvent, type EventDefinition } from "../events/catalog";

// The text itself is never recorded: notes may hold what should not travel with the history.
const NoteSavedV1 = defineEvent(
  "NoteSaved",
  1,
  z.strictObject({
    noteId: z.string(),
    workspaceId: z.string(),
    issueKey: z.string().nullable(),
    characters: z.number().int().positive(),
  }),
);

const NoteClearedV1 = defineEvent(
  "NoteCleared",
  1,
  z.strictObject({ noteId: z.string(), workspaceId: z.string(), issueKey: z.string().nullable() }),
);

export type NoteSavedPayload = z.infer<typeof NoteSavedV1.schema>;
export type NoteClearedPayload = z.infer<typeof NoteClearedV1.schema>;

export const NOTE_EVENTS: readonly EventDefinition[] = [NoteSavedV1, NoteClearedV1];
