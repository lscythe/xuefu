import { type Accessor, Match, Show, Switch } from "solid-js";
import type { AppError } from "../../application/errors";
import type { Note } from "../../domain/notes/note";
import type { Result } from "../../domain/shared/result";
import type { WorkContext } from "../../domain/work/work-context";
import type { Workspace } from "../../domain/workspace/workspace";
import { ErrorLine } from "../error-line";
import { PALETTE } from "../theme/palette";

/** The workspace's own note, and the note on its work in progress when there is some. */
export interface LoadedNotes {
  readonly own: Note | null;
  readonly issue: Note | null;
}

export interface NotesPanelProps {
  readonly workspace: Workspace | null;
  readonly work: WorkContext | null;
  readonly notes: Result<LoadedNotes, AppError> | null;
  readonly ascii: boolean;
}

/** A note's text, or how to start one: the command on a line of its own so it never wraps mid-flag. */
function NoteBody(props: {
  readonly note: Note | null;
  readonly empty: string;
  readonly command: string;
}) {
  return (
    <Show
      when={props.note}
      fallback={
        <>
          <text fg={PALETTE.textMuted}>{props.empty}</text>
          <text fg={PALETTE.textMuted}>{`  ${props.command}`}</text>
        </>
      }
    >
      {(note: Accessor<Note>) => <text fg={PALETTE.text}>{note().body}</text>}
    </Show>
  );
}

/** The Notes section: what to remember about the workspace and the issue being worked on. */
export function NotesPanel(props: NotesPanelProps) {
  return (
    <Switch>
      <Match when={props.workspace === null}>
        <text fg={PALETTE.textMuted}>Open a workspace with Ctrl+W to see its notes.</text>
      </Match>
      <Match when={props.notes !== null && !props.notes.ok && props.notes.error}>
        {(error: Accessor<AppError>) => <ErrorLine error={error()} ascii={props.ascii} />}
      </Match>
      <Match when={props.notes?.ok === true && props.notes.value}>
        {(notes: Accessor<LoadedNotes>) => (
          <box flexDirection="column" overflow="hidden" flexGrow={1}>
            <text fg={PALETTE.accentTertiary}>
              <b>{props.workspace?.name ?? ""}</b>
            </text>
            <NoteBody
              note={notes().own}
              empty="No note yet. Add one with:"
              command="xuefu note append <text>"
            />
            <Show when={props.work}>
              {(work: Accessor<WorkContext>) => (
                <>
                  <text> </text>
                  <text>
                    <span style={{ fg: PALETTE.accentSecondary }}>
                      <b>{work().issueKey}</b>
                    </span>
                    <span style={{ fg: PALETTE.textMuted }}>
                      {work().title === null ? "" : `  ${work().title}`}
                    </span>
                  </text>
                  <NoteBody
                    note={notes().issue}
                    empty={`No note on ${work().issueKey} yet. Add one with:`}
                    command={`xuefu note append --issue ${work().issueKey} <text>`}
                  />
                </>
              )}
            </Show>
          </box>
        )}
      </Match>
    </Switch>
  );
}
