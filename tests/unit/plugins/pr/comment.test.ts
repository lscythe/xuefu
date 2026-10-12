import { describe, expect, test } from "bun:test";
import { suggestedText } from "../../../../src/plugins/pr/domain/comment";

describe("suggestedText", () => {
  test("the text alone when it suggests no code", () => {
    expect(suggestedText("Looks risky.", null, "new")).toBe("Looks risky.");
  });

  test("a suggestion block on a line of the file after, for the author to apply", () => {
    expect(suggestedText("Await it.", "    authenticate().await()\n\n", "new")).toBe(
      "Await it.\n\n```suggestion\n    authenticate().await()\n```",
    );
  });

  test("plain code on a removed line, where there is nothing to replace", () => {
    expect(suggestedText("Keep the limit.", "if (tries > 3) lock()", "old")).toBe(
      "Keep the limit.\n\n```\nif (tries > 3) lock()\n```",
    );
  });

  test("a fence longer than any backticks in the code", () => {
    expect(suggestedText("Quote it.", 'val md = "```kotlin"', "new")).toBe(
      'Quote it.\n\n````suggestion\nval md = "```kotlin"\n````',
    );
  });
});
