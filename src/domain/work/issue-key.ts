import type { Brand } from "../shared/brand";
import { type ValidationError, validationError } from "../shared/errors";
import { err, ok, type Result } from "../shared/result";

/** A tracker issue such as "MOB-2841": project key, hyphen, issue number. Always upper case. */
export type IssueKey = Brand<string, "IssueKey">;

const ISSUE_KEY = /^[A-Z][A-Z0-9_]{0,9}-[1-9][0-9]{0,9}$/;

/** Accepts any case and surrounding spaces, so "mob-2841" typed by hand is "MOB-2841". */
export function issueKey(raw: string): Result<IssueKey, ValidationError> {
  const value = raw.trim().toUpperCase();
  if (!ISSUE_KEY.test(value)) {
    return err(
      validationError(
        "Issue key is invalid",
        [{ path: "issue", message: "must look like PROJ-123: a project key, '-' and a number" }],
        { raw },
      ),
    );
  }
  return ok(value as IssueKey);
}
