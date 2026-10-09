import { describe, expect, test } from "bun:test";
import type { ActivityEntry } from "../../../../src/application/activity/queries";
import type { WorkspaceId } from "../../../../src/domain/shared/ids";
import type { Timestamp } from "../../../../src/domain/shared/time";
import { activityRows } from "../../../../src/tui/shell/activity-rows";
import { view } from "../../../support/workspace-views";

const at = (iso: string) => Date.parse(iso) as Timestamp;
const NOW = at("2026-10-08T15:00:00Z");
const MOBILE = view("mobile-banking", "Mobile Banking").workspace;

function entry(
  iso: string,
  action: string,
  workspace: "mobile" | "removed" | "none" = "mobile",
): ActivityEntry {
  return {
    seq: 0,
    at: at(iso),
    workspaceId: workspace === "none" ? null : ("mobile-banking" as WorkspaceId),
    workspace: workspace === "mobile" ? MOBILE : null,
    description: { action, subject: null, detail: null },
  };
}

const ENTRIES = [
  entry("2026-10-08T14:10:00Z", "Paused the timer"),
  entry("2026-10-08T09:00:00Z", "Started the timer"),
  entry("2026-10-07T18:00:00Z", "Opened"),
  entry("2026-10-06T08:30:00Z", "Added"),
];

const options = { rows: 20, width: 80, now: NOW, timeZone: "UTC", workspaces: false };
const shape = (rows: ReturnType<typeof activityRows>) =>
  rows.map((row) =>
    row.kind === "day"
      ? row.label
      : [row.time, row.workspace, row.description.action].filter((part) => part !== null).join(" "),
  );

describe("activityRows", () => {
  test("groups entries under today, yesterday, then the date, in the given zone", () => {
    expect(shape(activityRows(ENTRIES, options))).toEqual([
      "Today",
      "14:10 Paused the timer",
      "09:00 Started the timer",
      "Yesterday",
      "18:00 Opened",
      "Tue 06 Oct",
      "08:30 Added",
    ]);
    // 15:00 UTC is already the next day in Tokyo.
    expect(
      shape(activityRows(ENTRIES.slice(0, 1), { ...options, timeZone: "Asia/Tokyo" })),
    ).toEqual(["Yesterday", "23:10 Paused the timer"]);
  });

  test("fills only the rows it has, never ending on a day heading", () => {
    expect(shape(activityRows(ENTRIES, { ...options, rows: 3 }))).toEqual([
      "Today",
      "14:10 Paused the timer",
      "09:00 Started the timer",
    ]);
    expect(shape(activityRows(ENTRIES, { ...options, rows: 4 }))).toEqual([
      "Today",
      "14:10 Paused the timer",
      "09:00 Started the timer",
    ]);
    expect(activityRows(ENTRIES, { ...options, rows: 1 })).toEqual([]);
  });

  test("names each workspace when asked, in a column as wide as the widest", () => {
    const rows = activityRows(
      [
        entry("2026-10-08T14:10:00Z", "Opened"),
        entry("2026-10-08T14:00:00Z", "Removed", "removed"),
        entry("2026-10-08T13:00:00Z", "Unrecognised event", "none"),
      ],
      { ...options, workspaces: true },
    );
    expect(shape(rows)).toEqual([
      "Today",
      "14:10 Mobile Banking Opened",
      "14:00 mobile-banking Removed",
      "13:00 -              Unrecognised event",
    ]);
  });

  test("a long workspace name is cut so the action keeps its room", () => {
    const long = { ...entry("2026-10-08T14:10:00Z", "Opened") };
    const named = { ...long, workspace: view("x", "Customer Onboarding Portal").workspace };
    const [, row] = activityRows([named], { ...options, workspaces: true });
    expect(row?.kind === "entry" && row.workspace).toBe("Customer Onboar…");
  });

  test("a line too wide gives up its detail first, then its subject", () => {
    const wide = (width: number) => {
      const described = {
        ...entry("2026-10-08T14:10:00Z", "Started work on"),
        description: {
          action: "Started work on",
          subject: { kind: "issue" as const, text: "MOB-2841" },
          detail: "Add biometric login",
        },
      };
      const [, row] = activityRows([described], { ...options, width });
      return row?.kind === "entry" ? row.description : null;
    };
    // "14:10  " takes 7 columns; "Started work on MOB-2841  Add biometric login" takes 45.
    expect(wide(52)).toMatchObject({
      subject: { text: "MOB-2841" },
      detail: "Add biometric login",
    });
    expect(wide(40)).toMatchObject({ subject: { text: "MOB-2841" }, detail: "Add bi…" });
    expect(wide(33)).toMatchObject({ subject: { text: "MOB-2841" }, detail: null });
    expect(wide(27)).toMatchObject({ action: "Started work on", subject: { text: "MOB…" } });
    expect(wide(12)).toMatchObject({ action: "Star…", subject: null, detail: null });
  });
});
