import { describe, expect, test } from "bun:test";
import type { ProjectBrief } from "../../../src/application/ports/project-context";
import {
  briefAge,
  freshBrief,
  INSTRUCTIONS,
  instructionsFor,
  studyPrompt,
} from "../../../src/bootstrap/agent-context";
import type { WorkspaceId } from "../../../src/domain/shared/ids";
import type { AbsolutePath } from "../../../src/domain/shared/path";
import type { Timestamp } from "../../../src/domain/shared/time";
import type { Workspace, WorkspaceName } from "../../../src/domain/workspace/workspace";

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 9, 12, 9, 0, 0) as Timestamp;
const MOBILE: Workspace = {
  id: "mobile" as WorkspaceId,
  name: "Mobile" as WorkspaceName,
  path: "/w" as AbsolutePath,
  group: null,
  addedAt: 0 as Timestamp,
  lastActiveAt: null,
};
const written = (daysAgo: number): ProjectBrief => ({
  workspaceId: MOBILE.id,
  text: "  Mobile is a Kotlin app.\n",
  createdAt: (NOW - daysAgo * DAY_MS) as Timestamp,
});

describe("freshBrief", () => {
  test("trusted for two weeks", () => {
    expect(freshBrief(null, NOW)).toBe(false);
    expect(freshBrief(written(0), NOW)).toBe(true);
    expect(freshBrief(written(13.9), NOW)).toBe(true);
    expect(freshBrief(written(14), NOW)).toBe(false);
  });
});

describe("briefAge", () => {
  test("in days, in words", () => {
    expect(briefAge(written(0.5), NOW)).toBe("today");
    expect(briefAge(written(-1), NOW)).toBe("today");
    expect(briefAge(written(1), NOW)).toBe("yesterday");
    expect(briefAge(written(3.2), NOW)).toBe("3 days ago");
  });
});

describe("studyPrompt", () => {
  test("learn the project, with the graph when there is one, then write a brief, changing nothing", () => {
    const withGraph = studyPrompt(true);
    expect(withGraph).toContain("graf's tools, such as stats, god_nodes");
    expect(withGraph).toContain("CLAUDE.md or AGENTS.md");
    expect(withGraph).toContain("Change nothing. Answer with the brief alone.");
    const without = studyPrompt(false);
    expect(without).not.toContain("graf");
    expect(without).toContain("Read its own guidance");
  });
});

describe("instructionsFor", () => {
  test("where it runs, how to use the graph, and what it learned", () => {
    expect(instructionsFor(MOBILE, null, false, NOW)).toBe(INSTRUCTIONS);
    const all = instructionsFor(MOBILE, written(2), true, NOW);
    expect(all.startsWith(INSTRUCTIONS)).toBe(true);
    expect(all).toContain("use impact on the files and symbols it touches");
    expect(
      all.endsWith(
        "What you learned of Mobile when you studied it 2 days ago:\n\nMobile is a Kotlin app.",
      ),
    ).toBe(true);
  });
});
