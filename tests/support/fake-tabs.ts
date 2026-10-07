import type { OpenTabs, WorkspaceView } from "../../src/application/workspace/queries";
import type { WorkspaceId } from "../../src/domain/shared/ids";
import { ok } from "../../src/domain/shared/result";
import { closeTab, NO_TABS, openTab, type WorkspaceTabs } from "../../src/domain/workspace/tabs";
import type { Workspace } from "../../src/domain/workspace/workspace";

/** In-memory tabs that follow the real domain rules, for driving the shell in tests. */
export function fakeTabs(views: readonly WorkspaceView[], ...open: string[]) {
  const byId = new Map(views.map((v) => [v.workspace.id as string, v.workspace]));
  let state: WorkspaceTabs = open.reduce(
    (tabs, id) => openTab(tabs, id as WorkspaceId),
    NO_TABS as WorkspaceTabs,
  );
  const view = (): OpenTabs => ({
    open: state.open.flatMap((id) => byId.get(id) ?? []),
    active: state.active === null ? null : (byId.get(state.active) ?? null),
  });
  return {
    initial: view(),
    activate: (workspace: Workspace) => {
      state = openTab(state, workspace.id);
      return Promise.resolve(ok(view()));
    },
    close: (workspace: Workspace) => {
      state = closeTab(state, workspace.id);
      return Promise.resolve(ok(view()));
    },
  };
}
