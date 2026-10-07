import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import {
  eraseChar,
  eraseWord,
  pastedText,
  type SwitcherRow,
  scrollOffset,
  switcherRows,
} from "../../../../src/tui/switcher/switcher-model";
import { view } from "../../../support/workspace-views";

const describeRows = (rows: readonly SwitcherRow[]) =>
  rows.map((row) => (row.kind === "group" ? `# ${row.label}` : row.view.workspace.id));

const views = [
  view("mobile-banking", "Mobile Banking", "Banking Client"),
  view("deployd", "deployd"),
  view("auth-service", "Auth Service", "Platform"),
  view("shared-sdk", "Shared SDK", "Banking Client"),
  view("mobile-wallet", "Mobile Wallet"),
];

describe("switcherRows", () => {
  test("an empty query groups workspaces by name, keeping registry order inside a group", () => {
    expect(describeRows(switcherRows(views, ""))).toEqual([
      "# Banking Client",
      "mobile-banking",
      "shared-sdk",
      "# Platform",
      "auth-service",
      "# Ungrouped",
      "deployd",
      "mobile-wallet",
    ]);
  });

  test("a group literally named Ungrouped is not merged with ungrouped workspaces", () => {
    const rows = switcherRows([view("a", "A", "Ungrouped"), view("b", "B")], "");
    expect(describeRows(rows)).toEqual(["# Ungrouped", "a", "# Ungrouped", "b"]);
  });

  test("without any groups there are no headers", () => {
    expect(describeRows(switcherRows([view("a", "A"), view("b", "B")], "  "))).toEqual(["a", "b"]);
  });

  test("a query gives a flat ranked list and highlights the key that matched", () => {
    const rows = switcherRows(views, "mob");
    expect(describeRows(rows)).toEqual(["mobile-wallet", "mobile-banking"]);
    const [first] = rows;
    expect(first?.kind === "workspace" && first.nameHits).toEqual([0, 1, 2]);
    expect(first?.kind === "workspace" && first.idHits).toEqual([]);
  });

  test("ids and group names are searchable too", () => {
    const byId = switcherRows([view("dpl", "Deploy Daemon")], "dpl");
    expect(byId[0]?.kind === "workspace" && byId[0].idHits).toEqual([0, 1, 2]);
    expect(describeRows(switcherRows(views, "banking client"))).toEqual([
      "mobile-banking",
      "shared-sdk",
    ]);
  });

  test("no match gives no rows", () => {
    expect(switcherRows(views, "zzz")).toEqual([]);
  });
});

describe("query editing", () => {
  test.each([
    ["mob", "mo"],
    ["", ""],
    ["血符", "血"],
    ["a😀", "a"],
  ])("eraseChar(%p) → %p", (query, expected) => {
    expect(eraseChar(query)).toBe(expected);
  });

  test.each([
    ["mobile bank", "mobile "],
    ["mobile bank  ", "mobile "],
    ["mobile-bank", "mobile-"],
    ["mobile-", "mobile"],
    ["mobile", ""],
    ["   ", ""],
    ["", ""],
  ])("eraseWord(%p) → %p", (query, expected) => {
    expect(eraseWord(query)).toBe(expected);
  });

  test("property: erasing a word always shortens a non-empty query", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 20 }), (query) => {
        expect(eraseWord(query).length).toBeLessThan(query.length);
        expect(query.startsWith(eraseWord(query))).toBe(true);
      }),
    );
  });
});

describe("pastedText", () => {
  test("pastes as one line without control characters", () => {
    expect(pastedText("mobile\n  bank\t\u0007")).toBe("mobile bank ");
  });
});

describe("scrollOffset", () => {
  test("no scrolling when everything fits", () => {
    expect(scrollOffset(4, 5, 10)).toBe(0);
  });

  test("keeps the selection near the middle and stops at the ends", () => {
    expect(scrollOffset(0, 30, 10)).toBe(0);
    expect(scrollOffset(15, 30, 10)).toBe(10);
    expect(scrollOffset(29, 30, 10)).toBe(20);
  });

  test("property: the selected row is always visible", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 200 }), fc.integer({ min: 1, max: 40 }), (rows, h) => {
        for (const selected of [0, Math.floor(rows / 2), rows - 1]) {
          const offset = scrollOffset(selected, rows, h);
          expect(offset).toBeGreaterThanOrEqual(0);
          expect(selected).toBeGreaterThanOrEqual(offset);
          expect(selected).toBeLessThan(offset + h);
        }
      }),
    );
  });
});
