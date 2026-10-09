import { z } from "zod";
import { appendToNote, type Note, type NoteBody, noteBody } from "../../domain/notes/note";
import {
  type DuplicateCommandError,
  type NotFoundError,
  type StorageError,
  type ValidationError,
  validationError,
} from "../../domain/shared/errors";
import { createEvent } from "../../domain/shared/event";
import { workspaceId } from "../../domain/shared/ids";
import { err, ok, type Result } from "../../domain/shared/result";
import { type IssueKey, issueKey } from "../../domain/work/issue-key";
import { findWorkspace } from "../../domain/workspace/registry";
import type { Workspace } from "../../domain/workspace/workspace";
import { defineCommand } from "../commands/command";
import type { CommandBus } from "../commands/command-bus";
import type { IdGenerator } from "../ports/id-generator";
import type { NoteRepository } from "../ports/note-repository";
import type { UnitOfWork } from "../ports/unit-of-work";
import type { WorkspaceRepository } from "../ports/workspace-repository";
import { looksLikeSecret } from "../security/redaction";
import { domainString } from "../validation";
import type { NoteClearedPayload, NoteSavedPayload } from "./events";

export interface NoteCommandDependencies {
  readonly notes: NoteRepository;
  readonly workspaces: WorkspaceRepository;
  readonly unitOfWork: UnitOfWork;
  readonly ids: IdGenerator;
}

export interface SavedNote {
  /** The note as saved; null when it was cleared, or there was none to clear. */
  readonly note: Note | null;
  /** False when the note already said exactly this. */
  readonly changed: boolean;
  /** The text looks like it holds a credential; notes are stored unencrypted. */
  readonly secret: boolean;
  readonly workspace: Workspace;
}

type NoteError = NotFoundError | ValidationError | StorageError;

/** Far above a note's limit; stops absurd input before it is copied around. */
const MAX_INPUT = 1_000_000;

/** Notes' write side. Blank text clears a note, so one command saves, appends and clears. */
export function noteCommands(deps: NoteCommandDependencies) {
  const { notes, workspaces, unitOfWork, ids } = deps;

  /** The note's next text: null clears it. */
  const nextBody = (
    current: Note | null,
    text: string,
    append: boolean,
  ): Result<NoteBody | null, ValidationError> => {
    const body = noteBody(text);
    if (!body.ok || !append) return body;
    if (body.value === null) {
      return err(
        validationError("Nothing to add to the note", [
          { path: "body", message: "type some text to add" },
        ]),
      );
    }
    return appendToNote(current?.body ?? null, body.value);
  };

  const save = defineCommand({
    name: "notes.save",
    title: "Save note",
    category: "Notes",
    safety: "safe",
    input: z.strictObject({
      workspace: domainString(workspaceId),
      issue: domainString(issueKey).optional(),
      body: z.string().max(MAX_INPUT),
      append: z.boolean().optional(),
    }),
    handler: (input, context) =>
      unitOfWork.run((tx): Result<SavedNote, NoteError> => {
        const loaded = workspaces.load();
        if (!loaded.ok) return loaded;
        const found = findWorkspace(loaded.value, input.workspace);
        if (!found.ok) return found;
        const issue: IssueKey | null = input.issue ?? null;
        const current = notes.find(input.workspace, issue);
        if (!current.ok) return current;
        const next = nextBody(current.value, input.body, input.append === true);
        if (!next.ok) return next;
        const workspace = found.value;
        const unchanged = { note: current.value, changed: false, workspace };

        const record = <T extends string, P extends object>(type: T, payload: P) =>
          tx.record(
            createEvent({
              id: ids.eventId(),
              type,
              version: 1,
              occurredAt: context.clock.now(),
              workspaceId: input.workspace,
              correlationId: context.correlationId,
              payload,
            }),
          );

        if (next.value === null) {
          if (current.value === null) return ok({ ...unchanged, secret: false });
          const removed = notes.remove(current.value.id);
          if (!removed.ok) return removed;
          record<"NoteCleared", NoteClearedPayload>("NoteCleared", {
            noteId: current.value.id,
            workspaceId: input.workspace,
            issueKey: issue,
          });
          return ok({ note: null, changed: true, secret: false, workspace });
        }

        const secret = looksLikeSecret(next.value);
        if (current.value?.body === next.value) return ok({ ...unchanged, secret });
        const note: Note = Object.freeze({
          id: current.value?.id ?? ids.noteId(),
          workspaceId: input.workspace,
          issueKey: issue,
          body: next.value,
          updatedAt: context.clock.now(),
        });
        const saved = notes.save(note);
        if (!saved.ok) return saved;
        record<"NoteSaved", NoteSavedPayload>("NoteSaved", {
          noteId: note.id,
          workspaceId: input.workspace,
          issueKey: issue,
          characters: note.body.length,
        });
        return ok({ note, changed: true, secret, workspace });
      }),
  });

  return { save } as const;
}

export type NoteCommands = ReturnType<typeof noteCommands>;

export function registerNoteCommands(
  bus: CommandBus,
  commands: NoteCommands,
): Result<void, DuplicateCommandError | ValidationError> {
  return bus.register(commands.save);
}
