import { describe, expect, test } from "bun:test";
import { wrapText } from "../../../src/tui/wrap";

describe("wrapText", () => {
  test("breaks at spaces, keeping each line within the width", () => {
    expect(wrapText("Falls back to the PIN after three failed attempts", 20)).toEqual([
      "Falls back to the",
      "PIN after three",
      "failed attempts",
    ]);
  });

  test("keeps line breaks and blank lines, reading Windows breaks and tabs", () => {
    expect(wrapText("h3. Why\r\n\r\n\tSlow", 20)).toEqual(["h3. Why", "", "  Slow"]);
  });

  test("a word longer than a line is cut across lines", () => {
    expect(wrapText("see https://jira.example.com/browse/MOB-2841", 16)).toEqual([
      "see",
      "https://jira.exa",
      "mple.com/browse/",
      "MOB-2841",
    ]);
  });

  test("wide characters count as two columns", () => {
    expect(wrapText("血符血符血符", 4)).toEqual(["血符", "血符", "血符"]);
  });
});
