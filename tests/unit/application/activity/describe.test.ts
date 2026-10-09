import { describe, expect, test } from "bun:test";
import { describeEvent, RECORDED_EVENTS } from "../../../../src/application/activity/describe";
import { EventCatalog } from "../../../../src/application/events/catalog";
import { testEvent } from "../../../support/events";

function catalog() {
  const created = EventCatalog.create(RECORDED_EVENTS);
  if (!created.ok) throw new Error(created.error.message);
  return created.value;
}

const describes = (type: string, payload: object) =>
  describeEvent(testEvent({ type, payload }), catalog());

describe("describeEvent", () => {
  test("workspace changes", () => {
    const path = "/work/mobile-banking";
    expect(describes("WorkspaceAdded", { id: "m", name: "M", path, group: null })).toEqual({
      action: "Added",
      subject: null,
      detail: path,
    });
    expect(describes("WorkspaceRemoved", { id: "m", name: "M", path })).toEqual({
      action: "Removed",
      subject: null,
      detail: path,
    });
    expect(describes("WorkspaceGroupAssigned", { id: "m", group: "Clients" })).toEqual({
      action: "Moved to group",
      subject: { kind: "name", text: "Clients" },
      detail: null,
    });
    expect(describes("WorkspaceGroupAssigned", { id: "m", group: null })).toMatchObject({
      action: "Taken out of its group",
      subject: null,
    });
    expect(describes("WorkspaceActivated", { id: "m" })).toMatchObject({ action: "Opened" });
    expect(describes("WorkspaceTabClosed", { id: "m" })).toMatchObject({
      action: "Closed its tab",
    });
  });

  test("work, with its title as the detail", () => {
    const work = { workId: "w", workspaceId: "m", issueKey: "MOB-2841" };
    expect(describes("WorkStarted", { ...work, title: "Add biometric login" })).toEqual({
      action: "Started work on",
      subject: { kind: "issue", text: "MOB-2841" },
      detail: "Add biometric login",
    });
    expect(describes("WorkStarted", { ...work, title: null }).detail).toBeNull();
    expect(describes("WorkStopped", { workId: "w", issueKey: "MOB-2841" })).toEqual({
      action: "Finished work on",
      subject: { kind: "issue", text: "MOB-2841" },
      detail: null,
    });
  });

  test("the timer, with the time tracked when it pauses or stops", () => {
    const started = { timerId: "t", workspaceId: "m" };
    expect(describes("TimerStarted", { ...started, issueKey: "MOB-1" })).toEqual({
      action: "Started the timer for",
      subject: { kind: "issue", text: "MOB-1" },
      detail: null,
    });
    expect(describes("TimerStarted", { ...started, issueKey: null })).toEqual({
      action: "Started the timer",
      subject: null,
      detail: null,
    });
    const tracked = { timerId: "t", elapsedMs: 6_138_000 };
    expect(describes("TimerPaused", tracked)).toMatchObject({
      action: "Paused the timer",
      detail: "01:42:18",
    });
    expect(describes("TimerResumed", { timerId: "t" })).toMatchObject({
      action: "Resumed the timer",
    });
    expect(describes("TimerStopped", tracked)).toMatchObject({
      action: "Stopped the timer",
      detail: "01:42:18",
    });
  });

  test("notes: the workspace's own, or an issue's", () => {
    const note = { noteId: "n", workspaceId: "m" };
    expect(describes("NoteSaved", { ...note, issueKey: null, characters: 12 })).toEqual({
      action: "Saved its note",
      subject: null,
      detail: null,
    });
    expect(describes("NoteSaved", { ...note, issueKey: "MOB-1", characters: 12 })).toMatchObject({
      action: "Saved the note on",
      subject: { kind: "issue", text: "MOB-1" },
    });
    expect(describes("NoteCleared", { ...note, issueKey: null })).toMatchObject({
      action: "Cleared its note",
    });
    expect(describes("NoteCleared", { ...note, issueKey: "MOB-1" })).toMatchObject({
      action: "Cleared the note on",
      subject: { text: "MOB-1" },
    });
  });

  test("an event it cannot read is shown as such, never dropped", () => {
    const unrecognised = {
      action: "Unrecognised event",
      subject: { kind: "name" as const, text: "FromTheFuture v1" },
      detail: null,
    };
    expect(describes("FromTheFuture", {})).toEqual(unrecognised);
    expect(describes("WorkStopped", { issue: 42 })).toEqual({
      ...unrecognised,
      subject: { kind: "name", text: "WorkStopped v1" },
    });
  });

  test("every recorded event has a description of its own", () => {
    const samples: Record<string, object> = {
      WorkspaceAdded: { id: "m", name: "M", path: "/m", group: null },
      WorkspaceRemoved: { id: "m", name: "M", path: "/m" },
      WorkspaceGroupAssigned: { id: "m", group: null },
      WorkspaceActivated: { id: "m" },
      WorkspaceTabClosed: { id: "m" },
      WorkStarted: { workId: "w", workspaceId: "m", issueKey: "MOB-1", title: null },
      WorkStopped: { workId: "w", issueKey: "MOB-1" },
      TimerStarted: { timerId: "t", workspaceId: "m", issueKey: null },
      TimerPaused: { timerId: "t", elapsedMs: 0 },
      TimerResumed: { timerId: "t" },
      TimerStopped: { timerId: "t", elapsedMs: 0 },
      NoteSaved: { noteId: "n", workspaceId: "m", issueKey: null, characters: 1 },
      NoteCleared: { noteId: "n", workspaceId: "m", issueKey: null },
    };
    expect(Object.keys(samples).sort()).toEqual(RECORDED_EVENTS.map((e) => e.type).sort());
    for (const [type, payload] of Object.entries(samples)) {
      expect(describes(type, payload).action).not.toBe("Unrecognised event");
    }
  });
});
