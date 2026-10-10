import type { HttpFailure } from "../../../application/ports/http-client";
import type { SecretFailure } from "../../../application/ports/secret-provider";
import type {
  ConfigurationError,
  NotFoundError,
  RemoteError,
  ValidationError,
} from "../../../domain/shared/errors";
import type { Result } from "../../../domain/shared/result";
import type { JiraIssue } from "../domain/issue";

type JiraFailure =
  | HttpFailure
  | SecretFailure
  | RemoteError
  | NotFoundError
  | ConfigurationError
  | ValidationError;

/** What XueFu reads from Jira. */
export interface JiraClient {
  /** Issues matching the JQL, in its order, up to `max`, with how many match in all. */
  search(
    jql: string,
    max: number,
    signal?: AbortSignal,
  ): Promise<Result<{ readonly issues: JiraIssue[]; readonly total: number }, JiraFailure>>;
  issue(key: string, signal?: AbortSignal): Promise<Result<JiraIssue, JiraFailure>>;
  /** Where the issue is in Jira's own web pages. */
  browseUrl(key: string): string;
}
