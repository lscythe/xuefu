import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import type { WorkspaceId } from "../../../../src/domain/shared/ids";
import {
  closeTab,
  MAX_TABS,
  NO_TABS,
  openTab,
  retainTabs,
  tabAt,
  type WorkspaceTabs,
} from "../../../../src/domain/workspace/tabs";

const id = (raw: string) => raw as WorkspaceId;
const tabs = (open: string[], active: string | null): WorkspaceTabs => ({
  open: open.map(id),
  active: active === null ? null : id(active),
});

describe("openTab", () => {
  test("appends a new workspace and focuses it", () => {
    expect(openTab(NO_TABS, id("a"))).toEqual(tabs(["a"], "a"));
    expect(openTab(tabs(["a"], "a"), id("b"))).toEqual(tabs(["a", "b"], "b"));
  });

  test("focuses a workspace that is already open without moving it", () => {
    expect(openTab(tabs(["a", "b", "c"], "c"), id("a"))).toEqual(tabs(["a", "b", "c"], "a"));
  });

  test("with every slot taken, the new workspace replaces the active tab in place", () => {
    const full = tabs(["a", "b", "c", "d", "e", "f", "g", "h", "i"], "c");
    expect(MAX_TABS).toBe(9);
    expect(openTab(full, id("z"))).toEqual(
      tabs(["a", "b", "z", "d", "e", "f", "g", "h", "i"], "z"),
    );
  });
});

describe("closeTab", () => {
  test("closing the active tab focuses its right neighbour, else its left", () => {
    expect(closeTab(tabs(["a", "b", "c"], "b"), id("b"))).toEqual(tabs(["a", "c"], "c"));
    expect(closeTab(tabs(["a", "b", "c"], "c"), id("c"))).toEqual(tabs(["a", "b"], "b"));
  });

  test("closing another tab keeps the focus", () => {
    expect(closeTab(tabs(["a", "b", "c"], "c"), id("a"))).toEqual(tabs(["b", "c"], "c"));
  });

  test("closing the last tab leaves nothing active; unknown ids change nothing", () => {
    expect(closeTab(tabs(["a"], "a"), id("a"))).toEqual(NO_TABS);
    expect(closeTab(tabs(["a"], "a"), id("x"))).toEqual(tabs(["a"], "a"));
  });
});

describe("tabAt", () => {
  test("is 1-based like Alt+1..9 and null past the end", () => {
    const three = tabs(["a", "b", "c"], "a");
    expect([tabAt(three, 1), tabAt(three, 3), tabAt(three, 4), tabAt(three, 0)]).toEqual([
      id("a"),
      id("c"),
      null,
      null,
    ]);
  });
});

describe("retainTabs", () => {
  test("drops workspaces that no longer exist and refocuses if needed", () => {
    const kept = retainTabs(tabs(["a", "b", "c"], "b"), new Set([id("a"), id("c")]));
    expect(kept).toEqual(tabs(["a", "c"], "c"));
  });
});

describe("invariants", () => {
  const ids = fc.constantFrom(..."abcdefghijkl".split("").map(id));
  const step = fc.oneof(
    fc.record({ op: fc.constant("open" as const), id: ids }),
    fc.record({ op: fc.constant("close" as const), id: ids }),
  );

  test("property: tabs stay unique, within the limit, and active is open (or null when empty)", () => {
    fc.assert(
      fc.property(fc.array(step, { maxLength: 60 }), (steps) => {
        let state = NO_TABS;
        for (const s of steps)
          state = s.op === "open" ? openTab(state, s.id) : closeTab(state, s.id);
        expect(new Set(state.open).size).toBe(state.open.length);
        expect(state.open.length).toBeLessThanOrEqual(MAX_TABS);
        if (state.open.length === 0) expect(state.active).toBeNull();
        else expect(state.open).toContain(state.active as WorkspaceId);
      }),
    );
  });
});
