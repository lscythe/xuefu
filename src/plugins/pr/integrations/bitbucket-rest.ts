import { z } from "zod";
import type { HttpClient, HttpRequest, HttpResponse } from "../../../application/ports/http-client";
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
  version: z.number().int(),
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
const VetoSchema = z.object({ summaryMessage: z.string() });
const ErrorsSchema = z.object({
  errors: z
    .array(z.object({ message: z.string(), vetoes: z.array(VetoSchema).optional() }))
    .optional(),
});
const UsersSchema = z.object({ values: z.array(z.object({ name: z.string(), slug: z.string() })) });
const MergeabilitySchema = z.object({
  canMerge: z.boolean(),
  conflicted: z.boolean().default(false),
  vetoes: z.array(VetoSchema).default([]),
});

const STATES: Readonly<Record<string, PullRequestState>> = {
  OPEN: "open",
  MERGED: "merged",
  DECLINED: "declined",
};
const REVIEWS: Readonly<Record<string, ReviewStatus>> = {
  APPROVED: "approved",
  NEEDS_WORK: "needs-work",
};
const REVIEW_STATUSES: Readonly<Record<ReviewStatus, string>> = {
  approved: "APPROVED",
  "needs-work": "NEEDS_WORK",
  unapproved: "UNAPPROVED",
};

/**
 * The first thing the server said was wrong, when it said anything, with what each merge check
 * that vetoed it says.
 */
function bitbucketSays(response: HttpResponse): string | null {
  try {
    const parsed = ErrorsSchema.safeParse(JSON.parse(response.body));
    const first = parsed.success ? parsed.data.errors?.[0] : undefined;
    if (first === undefined) return null;
    const vetoes = (first.vetoes ?? []).map((veto) => veto.summaryMessage);
    return vetoes.length === 0 ? first.message : `${first.message} (${vetoes.join("; ")})`;
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
      version: raw.version,
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
              ? "The token may not be allowed to do this: reading and reviewing take read access to the repository, merging takes write access."
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

  /** Sends a request with the token; any answer is returned, whatever its status. */
  const send = async (
    method: HttpRequest["method"],
    path: string,
    signal: AbortSignal | undefined,
    body?: unknown,
  ): Promise<Result<HttpResponse, PullRequestFailure>> => {
    const token = await options.token();
    if (!token.ok) return token;
    return http.request(
      {
        method,
        url: `${url}${path}`,
        headers: { Authorization: `Bearer ${token.value.reveal()}` },
        ...(body === undefined ? {} : { body }),
      },
      { timeoutMs: TIMEOUT_MS, ...(signal === undefined ? {} : { signal }) },
    );
  };

  /** Decodes a successful answer with `schema`; any other is a refusal. */
  const decode = <T>(
    response: HttpResponse,
    schema: z.ZodType<T>,
  ): Result<T, PullRequestFailure> => {
    if (response.status < 200 || response.status > 299) return err(refused(response));
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
          remoteError("Bitbucket's answer was not what XueFu expects", host, response.status, {
            hint: "Is plugins.pr.url the address of Bitbucket Data Center itself?",
          }),
        );
  };

  /** GETs a path, decoding the answer with `schema`. */
  const get = async <T>(
    path: string,
    schema: z.ZodType<T>,
    signal: AbortSignal | undefined,
  ): Promise<Result<T, PullRequestFailure>> => {
    const answered = await send("GET", path, signal);
    return answered.ok ? decode(answered.value, schema) : answered;
  };

  // The token's user, as the slug Bitbucket's addresses name users by; read once.
  let me: string | null = null;
  const whoAmI = async (
    signal: AbortSignal | undefined,
  ): Promise<Result<string, PullRequestFailure>> => {
    if (me !== null) return ok(me);
    // Bitbucket names the user it signed in in a header of each answer.
    const answered = await send("GET", "/rest/api/1.0/application-properties", signal);
    if (!answered.ok) return answered;
    if (answered.value.status !== 200) return err(refused(answered.value));
    const name = answered.value.headers["x-ausername"];
    if (name === undefined || name === "") {
      return err(
        remoteError("Bitbucket did not say whose the token is", host, answered.value.status, {
          hint: "Is plugins.pr.url the address of Bitbucket Data Center itself?",
        }),
      );
    }
    const query = new URLSearchParams({ filter: name, limit: "100" });
    const users = await get(`/rest/api/1.0/users?${query}`, UsersSchema, signal);
    if (!users.ok) return users;
    const found = users.value.values.find((user) => user.name === name);
    if (found === undefined) return err(notFound("user", name));
    me = found.slug;
    return ok(me);
  };

  /** A failure about one pull request, where a 404 means it is not there to read. */
  const gone = (
    failed: { readonly error: PullRequestFailure },
    repository: Repository,
    id: number,
  ): Result<never, PullRequestFailure> =>
    err(
      failed.error.kind === "remote" && failed.error.status === 404
        ? notFound("pull request", pullRequestRef({ repository, id }), {
            hint: "Check the project, repository and number, and that your token can read it.",
          })
        : failed.error,
    );

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
      return found.ok ? ok(toPullRequest(found.value)) : gone(found, repository, id);
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

    async review(repository, id, status, commit, signal) {
      const slug = await whoAmI(signal);
      if (!slug.ok) return slug;
      const answered = await send(
        "PUT",
        `${repoPath(repository)}/pull-requests/${id}/participants/${encodeURIComponent(slug.value)}`,
        signal,
        // Bound to the commit that was seen: a branch that moved since is refused.
        { status: REVIEW_STATUSES[status], lastReviewedCommit: commit },
      );
      if (!answered.ok) return answered;
      const reviewed = decode(answered.value, z.unknown());
      if (!reviewed.ok) return gone(reviewed, repository, id);
      return ok(undefined);
    },

    async mergeability(repository, id, signal) {
      const found = await get(
        `${repoPath(repository)}/pull-requests/${id}/merge`,
        MergeabilitySchema,
        signal,
      );
      if (!found.ok) return gone(found, repository, id);
      return ok({
        canMerge: found.value.canMerge,
        conflicted: found.value.conflicted,
        vetoes: found.value.vetoes.map((veto) => veto.summaryMessage),
      });
    },

    async merge(repository, id, version, signal) {
      const query = new URLSearchParams({ version: String(version) });
      const answered = await send(
        "POST",
        `${repoPath(repository)}/pull-requests/${id}/merge?${query}`,
        signal,
        {},
      );
      if (!answered.ok) return answered;
      const merged = decode(answered.value, PullRequestSchema);
      return merged.ok ? ok(toPullRequest(merged.value)) : gone(merged, repository, id);
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
