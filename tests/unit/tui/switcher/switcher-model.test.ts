import { describe, expect, test } from "bun:test";
import { type SwitcherRow, switcherRows } from "../../../../src/tui/switcher/switcher-model";
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
