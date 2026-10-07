import type { WorkspaceView } from "../../src/application/workspace/queries";
import type { WorkspaceId } from "../../src/domain/shared/ids";
import type { AbsolutePath } from "../../src/domain/shared/path";
import type { Timestamp } from "../../src/domain/shared/time";
import type { GroupName, WorkspaceName } from "../../src/domain/workspace/workspace";

/** A registered workspace as the switcher sees it; folder under /work/<id>. */
export function view(
  id: string,
  name: string,
  group: string | null = null,
  status: WorkspaceView["status"] = "ready",
): WorkspaceView {
  return {
    workspace: {
      id: id as WorkspaceId,
      name: name as WorkspaceName,
      path: `/work/${id}` as AbsolutePath,
      group: group as GroupName | null,
      addedAt: 0 as Timestamp,
      lastActiveAt: null,
    },
    status,
    capabilities: { git: true, gradle: false },
  };
}
