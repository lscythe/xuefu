import type { Brand } from "../shared/brand";
import { type ValidationError, validationError } from "../shared/errors";
import type { WorkspaceId } from "../shared/ids";
import type { AbsolutePath } from "../shared/path";
import { err, ok, type Result } from "../shared/result";
import type { Timestamp } from "../shared/time";

/** Display name shown in the switcher and header; any script, no control characters. */
export type WorkspaceName = Brand<string, "WorkspaceName">;

/** Free-form label used to cluster workspaces in the switcher (e.g. a client or team). */
export type GroupName = Brand<string, "GroupName">;

/** A local project folder registered with XueFu. */
export interface Workspace {
  readonly id: WorkspaceId;
  readonly name: WorkspaceName;
  /** Canonical (symlink-resolved) project root. */
  readonly path: AbsolutePath;
  readonly group: GroupName | null;
  readonly addedAt: Timestamp;
  /** When the workspace was last opened in the cockpit; null until it first is. */
  readonly lastActiveAt: Timestamp | null;
}

const CONTROL_CHARACTER = /\p{Cc}/u;
const MAX_ID_LENGTH = 64;

function label<T extends string>(
  what: string,
  maxLength: number,
  raw: string,
): Result<Brand<string, T>, ValidationError> {
  const value = raw.trim();
  const problem =
    value.length === 0
      ? "must not be empty"
      : value.length > maxLength
        ? `must be at most ${maxLength} characters`
        : CONTROL_CHARACTER.test(value)
          ? "must not contain control characters"
          : null;
  if (problem !== null) {
    return err(validationError(`${what} is invalid`, [{ path: "name", message: problem }]));
  }
  return ok(value as Brand<string, T>);
}

export function workspaceName(raw: string): Result<WorkspaceName, ValidationError> {
  return label("Workspace name", 64, raw);
}

export function groupName(raw: string): Result<GroupName, ValidationError> {
  return label("Group name", 32, raw);
}

/**
 * Lowercase ASCII slug for a display name, or null when nothing usable remains (e.g. a name
 * written only in CJK). Accents are folded: "Crème" becomes "creme".
 */
export function suggestWorkspaceId(name: string): string | null {
  const slug = name
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+/, "")
    .slice(0, MAX_ID_LENGTH)
    .replace(/-+$/, "");
  return slug === "" ? null : slug;
}
