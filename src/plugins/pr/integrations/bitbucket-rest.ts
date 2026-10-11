import { z } from "zod";
import type { HttpClient, HttpResponse } from "../../../application/ports/http-client";
import type { SecretFailure } from "../../../application/ports/secret-provider";
import { notFound, type RemoteError, remoteError } from "../../../domain/shared/errors";
import { err, ok, type Result } from "../../../domain/shared/result";
import type { Secret } from "../../../domain/shared/secret";
import type { PullRequestClient, PullRequestFailure } from "../application/pull-request-client";
import {
  type PullRequest,
  type PullRequestState,
  pullRequestRef,
  type Repository,
  type ReviewStatus,
} from "../domain/pull-request";

const TIMEOUT_MS = 20_000;

const RefSchema = z.object({
  displayId: z.string(),
  latestCommit: z.string(),
  repository: z.object({ slug: z.string(), project: z.object({ key: z.string() }) }),
});
const ParticipantSchema = z.object({
  user: z.object({ displayName: z.string() }),
  status: z.string().optional(),
});

/** A pull request as REST 1.0 sends it; only what XueFu shows is read, the rest is ignored. */
const PullRequestSchema = z.object({
  id: z.number().int(),
  title: z.string(),
  description: z.string().nullish(),
  state: z.string(),
  createdDate: z.number(),
  updatedDate: z.number(),
  fromRef: RefSchema,
  toRef: RefSchema,
  author: ParticipantSchema,
  reviewers: z.array(ParticipantSchema).default([]),
  properties: z
    .object({
      commentCount: z.number().int().optional(),
      openTaskCount: z.number().int().optional(),
      mergeResult: z.object({ outcome: z.string() }).optional(),
    })
    .optional(),
  links: z.object({ self: z.array(z.object({ href: z.string() })) }).optional(),
});

const PageSchema = z.object({ values: z.array(PullRequestSchema), isLastPage: z.boolean() });
const BuildStatsSchema = z.object({
  successful: z.number().int().default(0),
  failed: z.number().int().default(0),
  inProgress: z.number().int().default(0),
});
const ErrorsSchema = z.object({ errors: z.array(z.object({ message: z.string() })).optional() });

const STATES: Readonly<Record<string, PullRequestState>> = {
  OPEN: "open",
  MERGED: "merged",
  DECLINED: "declined",
};
const REVIEWS: Readonly<Record<string, ReviewStatus>> = {
  APPROVED: "approved",
  NEEDS_WORK: "needs-work",
};

/** The first thing the server said was wrong, when it said anything. */
function bitbucketSays(response: HttpResponse): string | null {
  try {
    const parsed = ErrorsSchema.safeParse(JSON.parse(response.body));
    return parsed.success ? (parsed.data.errors?.[0]?.message ?? null) : null;
  } catch {
    return null;
  }
}

export interface BitbucketRestOptions {
  readonly http: HttpClient;
  /** The address Bitbucket is served from, without a trailing slash. */
  readonly url: string;
  /** The HTTP access token, looked up when first needed. */
  readonly token: () => Promise<Result<Secret, SecretFailure>>;
}

/** Bitbucket Data Center's REST API, version 1.0, with an HTTP access token. */
export function bitbucketRest(options: BitbucketRestOptions): PullRequestClient {
  const { http, url } = options;
  const host = new URL(url).host;

  const toPullRequest = (raw: z.infer<typeof PullRequestSchema>): PullRequest => {
    const repository = {
      project: raw.toRef.repository.project.key,
      slug: raw.toRef.repository.slug,
    };
    const outcome = raw.properties?.mergeResult?.outcome;
    return {
      repository,
      id: raw.id,
      title: raw.title,
      description: raw.description ?? null,
      state: STATES[raw.state] ?? "open",
      from: raw.fromRef.displayId,
      to: raw.toRef.displayId,
      commit: raw.fromRef.latestCommit,
      author: raw.author.user.displayName,
      reviewers: raw.reviewers.map((reviewer) => ({
        name: reviewer.user.displayName,
        status: REVIEWS[reviewer.status ?? ""] ?? "unapproved",
      })),
      created: raw.createdDate,
      updated: raw.updatedDate,
      comments: raw.properties?.commentCount ?? 0,
      openTodos: raw.properties?.openTaskCount ?? 0,
      conflicted: outcome === undefined ? null : outcome === "CONFLICTED",
      url:
        raw.links?.self[0]?.href ??
        `${url}/projects/${repository.project}/repos/${repository.slug}/pull-requests/${raw.id}`,
    };
  };

  const refused = (response: HttpResponse): RemoteError => {
    const said = bitbucketSays(response);
    switch (response.status) {
      case 401:
        return remoteError("Bitbucket did not accept the token", host, 401, {
          hint: "Make an HTTP access token in Bitbucket (Manage account, HTTP access tokens) and point plugins.pr.token at it.",
        });
      case 403:
        return remoteError("Bitbucket refused the request", host, 403, {
          hint:
            response.headers["x-authentication-denied-reason"] === undefined
              ? "The token may not be allowed to read this; it needs read access to the repositories."
              : "Bitbucket wants a CAPTCHA after failed logins: log in once in a browser, then try again.",
        });
      case 429:
        return remoteError("Bitbucket is limiting how often XueFu may ask", host, 429, {
          hint: "Try again in a minute, or raise plugins.pr.refreshSeconds.",
        });
      default:
        return remoteError(
          `Bitbucket answered ${response.status}${said === null ? "" : `: ${said}`}`,
          host,
          response.status,
        );
    }
  };

  /** GETs a path, decoding a 200 with `schema`. */
  const get = async <T>(
    path: string,
    schema: z.ZodType<T>,
    signal: AbortSignal | undefined,
  ): Promise<Result<T, PullRequestFailure>> => {
    const token = await options.token();
    if (!token.ok) return token;
    const answered = await http.request(
      {
        method: "GET",
        url: `${url}${path}`,
        headers: { Authorization: `Bearer ${token.value.reveal()}` },
      },
      { timeoutMs: TIMEOUT_MS, ...(signal === undefined ? {} : { signal }) },
    );
    if (!answered.ok) return answered;
    const response = answered.value;
    if (response.status !== 200) return err(refused(response));
    let json: unknown;
    try {
      json = JSON.parse(response.body);
    } catch {
      json = undefined;
    }
    const parsed = schema.safeParse(json);
    return parsed.success
      ? ok(parsed.data)
      : err(
          remoteError("Bitbucket's answer was not what XueFu expects", host, 200, {
            hint: "Is plugins.pr.url the address of Bitbucket Data Center itself?",
          }),
        );
  };

  const repoPath = (repository: Repository) =>
    `/rest/api/1.0/projects/${encodeURIComponent(repository.project)}/repos/${encodeURIComponent(repository.slug)}`;

  return {
    async mine(role, max, signal) {
      const query = new URLSearchParams({
        role: role === "author" ? "AUTHOR" : "REVIEWER",
        state: "OPEN",
        limit: String(max),
      });
      const found = await get(`/rest/api/1.0/dashboard/pull-requests?${query}`, PageSchema, signal);
      if (!found.ok) return found;
      return ok({
        pullRequests: found.value.values.map(toPullRequest).sort((a, b) => b.updated - a.updated),
        more: !found.value.isLastPage,
      });
    },

    async pullRequest(repository, id, signal) {
      const found = await get(
        `${repoPath(repository)}/pull-requests/${id}`,
        PullRequestSchema,
        signal,
      );
      if (!found.ok) {
        return found.error.kind === "remote" && found.error.status === 404
          ? err(
              notFound("pull request", pullRequestRef({ repository, id }), {
                hint: "Check the project, repository and number, and that your token can read it.",
              }),
            )
          : found;
      }
      return ok(toPullRequest(found.value));
    },

    async forBranch(repository, branch, signal) {
      const query = new URLSearchParams({
        at: `refs/heads/${branch}`,
        direction: "OUTGOING",
        state: "OPEN",
        limit: "1",
      });
      const found = await get(`${repoPath(repository)}/pull-requests?${query}`, PageSchema, signal);
      if (!found.ok) return found;
      const first = found.value.values[0];
      return ok(first === undefined ? null : toPullRequest(first));
    },

    builds(commit, signal) {
      return get(
        `/rest/build-status/1.0/commits/stats/${encodeURIComponent(commit)}`,
        BuildStatsSchema,
        signal,
      );
    },
  };
}
