import { describe, expect, test } from "bun:test";
import { ok } from "../../../../src/domain/shared/result";
import { issueKey } from "../../../../src/domain/work/issue-key";
import {
  fieldValue,
  type PaletteEntry,
  type PaletteField,
  paletteRows,
} from "../../../../src/tui/palette/palette-model";

const entry = (title: string): PaletteEntry => ({
  title,
  keys: null,
  fields: [],
  run: () => Promise.resolve(ok(undefined)),
});
const ENTRIES = [
  entry("Start work"),
  entry("Pause timer"),
  entry("Switch workspace"),
  entry("Quit"),
];
const ISSUE: PaletteField = {
  label: "Issue key",
  example: "MOB-2841",
  optional: false,
  check: issueKey,
};

describe("paletteRows", () => {
  test("a blank query lists every entry in order", () => {
    expect(paletteRows(ENTRIES, "  ").map((row) => row.entry.title)).toEqual([
      "Start work",
      "Pause timer",
      "Switch workspace",
      "Quit",
    ]);
  });

  test("a query ranks matching titles and marks the matched letters", () => {
    const rows = paletteRows(ENTRIES, "sw");
    expect(rows.map((row) => row.entry.title)).toEqual(["Switch workspace", "Start work"]);
    expect(rows[0]?.hits).toEqual([0, 1]);
    expect(paletteRows(ENTRIES, "zzz")).toEqual([]);
  });
});

describe("fieldValue", () => {
  test("trims and checks the text", () => {
    expect(fieldValue(ISSUE, " mob-1 ")).toEqual({ ok: true, value: "mob-1" });
    expect(fieldValue(ISSUE, "nope")).toMatchObject({
      ok: false,
      error: { message: "Issue key is invalid" },
    });
  });

  test("empty is null when optional, and an error naming an example when required", () => {
    expect(fieldValue({ ...ISSUE, optional: true }, "  ")).toEqual({ ok: true, value: null });
    expect(fieldValue(ISSUE, "")).toMatchObject({
      ok: false,
      error: { message: "Issue key is required", issues: [{ message: "type one, e.g. MOB-2841" }] },
    });
  });
});
