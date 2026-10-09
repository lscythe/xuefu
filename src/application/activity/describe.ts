import type { DomainEvent } from "../../domain/shared/event";
import { clockDuration, type Duration } from "../../domain/shared/time";
import type { EventCatalog, EventDefinition } from "../events/catalog";
import { NOTE_EVENTS, type NoteClearedPayload, type NoteSavedPayload } from "../notes/events";
import {
  TIMER_EVENTS,
  type TimerPausedPayload,
  type TimerStartedPayload,
  type TimerStoppedPayload,
} from "../timesheet/events";
import { WORK_EVENTS, type WorkStartedPayload, type WorkStoppedPayload } from "../work/events";
import {
  WORKSPACE_EVENTS,
  type WorkspaceAddedPayload,
  type WorkspaceGroupAssignedPayload,
  type WorkspaceRemovedPayload,
} from "../workspace/events";

/** Every event XueFu records, for reading the ledger back. */
export const RECORDED_EVENTS: readonly EventDefinition[] = [
  ...WORKSPACE_EVENTS,
  ...WORK_EVENTS,
  ...TIMER_EVENTS,
  ...NOTE_EVENTS,
];

/** What an event's subject is, so it can be set apart: an issue key or a name. */
export interface ActivitySubject {
  readonly kind: "issue" | "name";
  readonly text: string;
}

/**
 * An event in words, read after the workspace it happened in: "Started work on" MOB-2841,
 * "Add biometric login".
 */
export interface ActivityDescription {
  readonly action: string;
  readonly subject: ActivitySubject | null;
  /** Supporting facts, such as a title, a path or the time tracked. */
  readonly detail: string | null;
}

const said = (
  action: string,
  subject: ActivitySubject | null = null,
  detail: string | null = null,
): ActivityDescription => ({ action, subject, detail });

const issue = (text: string): ActivitySubject => ({ kind: "issue", text });
const name = (text: string): ActivitySubject => ({ kind: "name", text });
const tracked = (payload: { readonly elapsedMs: number }) =>
  clockDuration(payload.elapsedMs as Duration);

// Typed by the payload each schema guarantees; `never` lets the table hold them all.
const DESCRIPTIONS: Readonly<Record<string, (payload: never) => ActivityDescription>> = {
  WorkspaceAdded: (p: WorkspaceAddedPayload) => said("Added", null, p.path),
  WorkspaceRemoved: (p: WorkspaceRemovedPayload) => said("Removed", null, p.path),
  WorkspaceGroupAssigned: (p: WorkspaceGroupAssignedPayload) =>
    p.group === null ? said("Taken out of its group") : said("Moved to group", name(p.group)),
  WorkspaceActivated: () => said("Opened"),
  WorkspaceTabClosed: () => said("Closed its tab"),
  WorkStarted: (p: WorkStartedPayload) => said("Started work on", issue(p.issueKey), p.title),
  WorkStopped: (p: WorkStoppedPayload) => said("Finished work on", issue(p.issueKey)),
  TimerStarted: (p: TimerStartedPayload) =>
    p.issueKey === null
      ? said("Started the timer")
      : said("Started the timer for", issue(p.issueKey)),
  TimerPaused: (p: TimerPausedPayload) => said("Paused the timer", null, tracked(p)),
  TimerResumed: () => said("Resumed the timer"),
  TimerStopped: (p: TimerStoppedPayload) => said("Stopped the timer", null, tracked(p)),
  NoteSaved: (p: NoteSavedPayload) =>
    p.issueKey === null ? said("Saved its note") : said("Saved the note on", issue(p.issueKey)),
  NoteCleared: (p: NoteClearedPayload) =>
    p.issueKey === null ? said("Cleared its note") : said("Cleared the note on", issue(p.issueKey)),
};

/**
 * Describes an event from the ledger. One this version cannot read, from a newer XueFu or with a
 * damaged payload, is described as unrecognised rather than dropped.
 */
export function describeEvent(event: DomainEvent, catalog: EventCatalog): ActivityDescription {
  const decoded = catalog.decode(event);
  const describe = DESCRIPTIONS[event.type];
  if (!decoded.ok || describe === undefined) {
    return said("Unrecognised event", name(`${event.type} v${event.version}`));
  }
  return describe(decoded.value.payload as never);
}
