import { type ValidationError, validationError } from "../../../domain/shared/errors";
import { err, ok, type Result } from "../../../domain/shared/result";

/** A repository on the server: its project's key and its slug, as "MOB" and "mobile-banking". */
export interface Repository {
  readonly project: string;
  readonly slug: string;
}

export type PullRequestState = "open" | "merged" | "declined";

/** Where a reviewer stands: approved, asking for changes, or not yet either. */
export type ReviewStatus = "approved" | "needs-work" | "unapproved";

export interface Reviewer {
  readonly name: string;
  readonly status: ReviewStatus;
  readonly lastReviewedCommit?: string | null;
}

export function reviewFreshness(
  reviewer: Reviewer,
  commit: string,
): "current" | "outdated" | "unknown" {
  if (!reviewer.lastReviewedCommit || !commit) return "unknown";
  return reviewer.lastReviewedCommit === commit ? "current" : "outdated";
}

export interface PullRequest {
  readonly repository: Repository;
  readonly id: number;
  /** Counts its changes; a merge names it, so one changed since it was read is refused. */
  readonly version: number;
  readonly title: string;
  /** As written, in Markdown; null when there is none. */
  readonly description: string | null;
  readonly state: PullRequestState;
  /** The branches it merges from and into, as "feature/MOB-2841" and "main". */
  readonly from: string;
  readonly to: string;
  /** The latest commit on the branch it merges from. */
  readonly commit: string;
  readonly author: string;
  readonly reviewers: readonly Reviewer[];
  /** Milliseconds since the epoch. */
  readonly created: number;
  readonly updated: number;
  readonly comments: number;
  /** To-dos reviewers left on it that are not done yet. */
  readonly openTodos: number;
  /** Whether merging would conflict; null when the server has not said. */
  readonly conflicted: boolean | null;
  /** Its page on the server. */
  readonly url: string;
}

/** Bitbucket's project keys are upper case; a personal one, "~user", keeps its case. */
const projectKey = (raw: string) => (raw.startsWith("~") ? raw : raw.toUpperCase());

/**
 * The repository a clone address points at on the Bitbucket at `host`, read from HTTPS
 * ("https://host/scm/mob/app.git") or SSH ("ssh://git@host:7999/mob/app.git", "git@host:mob/app")
 * addresses. Null for one on another host, or not shaped like Bitbucket's.
 */
export function repositoryFromRemote(remote: string, host: string): Repository | null {
  const scp = /^[^@/\s]+@([^:/\s]+):(?!\/)(.+)$/.exec(remote.trim());
  let hostname: string;
  let path: string;
  if (scp !== null) {
    hostname = scp[1] ?? "";
    path = scp[2] ?? "";
  } else if (URL.canParse(remote.trim())) {
    const url = new URL(remote.trim());
    hostname = url.hostname;
    path = decodeURIComponent(url.pathname);
  } else {
    return null;
  }
  if (hostname.toLowerCase() !== host.toLowerCase()) return null;
  // HTTPS clones go through /scm/, after any context path Bitbucket is served under.
  const parts = path
    .replace(/\.git$/, "")
    .split("/")
    .filter((part) => part !== "");
  const scm = parts.lastIndexOf("scm");
  const [project, slug, ...rest] = scm === -1 ? parts : parts.slice(scm + 1);
  if (project === undefined || slug === undefined || rest.length > 0) return null;
  return { project: projectKey(project), slug: slug.toLowerCase() };
}

/** "MOB/mobile-banking#42": names a pull request anywhere on the server. */
export function pullRequestRef(pull: Pick<PullRequest, "repository" | "id">): string {
  return `${pull.repository.project}/${pull.repository.slug}#${pull.id}`;
}

const REF = /^([A-Za-z~][A-Za-z0-9_~-]{0,127})\/([A-Za-z0-9._-]{1,128})#([1-9][0-9]{0,9})$/;

/** Reads "MOB/mobile-banking#42"; the project key is upper-cased, as the server keeps it. */
export function parsePullRequestRef(
  raw: string,
): Result<{ readonly repository: Repository; readonly id: number }, ValidationError> {
  const match = REF.exec(raw.trim());
  if (match === null) {
    return err(
      validationError("Pull request is invalid", [
        { path: "pull request", message: "must look like PROJECT/repository#42" },
      ]),
    );
  }
  const [, project = "", slug = "", id = ""] = match;
  return ok({ repository: { project: projectKey(project), slug }, id: Number(id) });
}

/** How the reviews stand: how many approved of how many reviewers, and who wants changes. */
export function reviewSummary(pull: Pick<PullRequest, "reviewers">): {
  readonly approved: number;
  readonly reviewers: number;
  readonly needsWork: number;
} {
  const count = (status: ReviewStatus) =>
    pull.reviewers.filter((reviewer) => reviewer.status === status).length;
  return {
    approved: count("approved"),
    reviewers: pull.reviewers.length,
    needsWork: count("needs-work"),
  };
}

/** Builds reported for a commit, by how they ended. */
export interface BuildSummary {
  readonly successful: number;
  readonly failed: number;
  readonly inProgress: number;
}
