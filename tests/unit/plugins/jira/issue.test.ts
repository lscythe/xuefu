import { describe, expect, test } from "bun:test";
import {
  type JiraTransition,
  startTransition,
  statusCategory,
  workTitle,
} from "../../../../src/plugins/jira/domain/issue";

const move = (id: string, name: string, to: string, category = "doing"): JiraTransition => ({
  id,
  name,
  to: { name: to, category: category === "doing" ? "doing" : statusCategory(category) },
});

describe("startTransition", () => {
  test("the move to a status named for progress, over others under way", () => {
    expect(
      startTransition([
        move("21", "Send to review", "In Review"),
        move("11", "Begin", "In Progress"),
        move("31", "Close", "Done", "done"),
      ])?.id,
    ).toBe("11");
  });

  test("else one whose name starts work, else any under way, else none", () => {
    expect(
      startTransition([move("21", "Review", "In Review"), move("41", "Start", "Doing")])?.id,
    ).toBe("41");
    expect(startTransition([move("21", "Review", "In Review")])?.id).toBe("21");
    expect(startTransition([move("31", "Close", "Done", "done")])).toBeNull();
    expect(startTransition([])).toBeNull();
  });
});

describe("workTitle", () => {
  test("puts the summary on one line", () => {
    expect(workTitle("  Crash on\nrotate\t screen  ")).toBe("Crash on rotate screen");
  });

  test("cuts a long summary to fit, marking the cut", () => {
    const title = workTitle("word ".repeat(60));
    expect(title).toHaveLength(200);
    expect(title).toEndWith("word…");
  });
});
