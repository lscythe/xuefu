import { z } from "zod";
import type { HttpClient, HttpResponse } from "../../../application/ports/http-client";
import type { SecretFailure } from "../../../application/ports/secret-provider";
import {
  configurationError,
  notFound,
  type RemoteError,
  remoteError,
} from "../../../domain/shared/errors";
import { err, ok, type Result } from "../../../domain/shared/result";
import type { Secret } from "../../../domain/shared/secret";
import type { JiraClient, JiraFailure } from "../application/jira-client";
import { type JiraIssue, statusCategory } from "../domain/issue";

const TIMEOUT_MS = 20_000;
const LIST_FIELDS = "summary,status,issuetype,priority,assignee,reporter,created,updated";
const ISSUE_FIELDS = `${LIST_FIELDS},description`;

const Named = z.object({ name: z.string() }).nullish();
const Person = z.object({ displayName: z.string() }).nullish();

/** An issue as REST v2 sends it; only what XueFu shows is read, the rest is ignored. */
const IssueSchema = z.object({
  key: z.string(),
  fields: z.object({
    summary: z.string(),
    status: z.object({ name: z.string(), statusCategory: z.object({ key: z.string() }) }),
    issuetype: z.object({ name: z.string() }),
    priority: Named,
    assignee: Person,
    reporter: Person,
    created: z.string(),
    updated: z.string(),
    description: z.string().nullish(),
  }),
});

const SearchSchema = z.object({ issues: z.array(IssueSchema), total: z.number().int() });
const TransitionsSchema = z.object({
  transitions: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      to: z.object({ name: z.string(), statusCategory: z.object({ key: z.string() }) }),
    }),
  ),
});
const ErrorsSchema = z.object({
  errorMessages: z.array(z.string()).optional(),
  /** Per field, when what was sent does not satisfy the workflow. */
  errors: z.record(z.string(), z.string()).optional(),
});

/** Jira writes offsets as "+0200"; JavaScript dates read only "+02:00". */
export function jiraTime(text: string): number {
  return Date.parse(text.replace(/([+-]\d{2})(\d{2})$/, "$1:$2"));
}

function toIssue(raw: z.infer<typeof IssueSchema>): JiraIssue {
  const { fields } = raw;
  return {
    key: raw.key,
    summary: fields.summary,
    status: {
      name: fields.status.name,
      category: statusCategory(fields.status.statusCategory.key),
    },
    type: fields.issuetype.name,
    priority: fields.priority?.name ?? null,
    assignee: fields.assignee?.displayName ?? null,
    reporter: fields.reporter?.displayName ?? null,
    created: jiraTime(fields.created),
    updated: jiraTime(fields.updated),
    description: fields.description ?? null,
  };
}

/** The first thing Jira said was wrong, when it said anything. */
function jiraSays(response: HttpResponse): string | null {
  try {
    const parsed = ErrorsSchema.safeParse(JSON.parse(response.body));
    if (!parsed.success) return null;
    const { errorMessages, errors } = parsed.data;
    return errorMessages?.[0] ?? Object.values(errors ?? {})[0] ?? null;
  } catch {
    return null;
  }
}

export interface JiraRestOptions {
  readonly http: HttpClient;
  /** The address Jira is served from, without a trailing slash. */
  readonly url: string;
  /** The personal access token, looked up when first needed. */
  readonly token: () => Promise<Result<Secret, SecretFailure>>;
  /** Where the settings live, for errors that point at them. */
  readonly source: string;
}

/** Jira Data Center's REST API, version 2, with a personal access token. */
export function jiraRest(options: JiraRestOptions): JiraClient {
  const { http, url, source } = options;
  const host = new URL(url).host;

  const refused = (response: HttpResponse): RemoteError => {
    const said = jiraSays(response);
    switch (response.status) {
      case 401:
        return remoteError("Jira did not accept the token", host, 401, {
          hint: "Make a personal access token in Jira (Profile, Personal Access Tokens) and point plugins.jira.token at it.",
        });
      case 403:
        return remoteError("Jira refused the request", host, 403, {
          hint:
            response.headers["x-authentication-denied-reason"] === undefined
              ? "The token's user may not be allowed to see this."
              : "Jira wants a CAPTCHA after failed logins: log in once in a browser, then try again.",
        });
      case 429:
        return remoteError("Jira is limiting how often XueFu may ask", host, 429, {
          hint: "Try again in a minute, or raise plugins.jira.refreshSeconds.",
        });
      default:
        return remoteError(
          `Jira answered ${response.status}${said === null ? "" : `: ${said}`}`,
          host,
          response.status,
        );
    }
  };

  /** Asks Jira, giving back a 2xx answer; other statuses go to `otherwise` or `refused`. */
  const ask = async (
    request: { readonly method: "GET" | "POST"; readonly path: string; readonly body?: unknown },
    signal: AbortSignal | undefined,
    otherwise: (response: HttpResponse) => RemoteError | null = () => null,
  ) => {
    const token = await options.token();
    if (!token.ok) return token;
    const answered = await http.request(
      {
        method: request.method,
        url: `${url}${request.path}`,
        headers: { Authorization: `Bearer ${token.value.reveal()}` },
        ...(request.body === undefined ? {} : { body: request.body }),
      },
      { timeoutMs: TIMEOUT_MS, ...(signal === undefined ? {} : { signal }) },
    );
    if (!answered.ok) return answered;
    const response = answered.value;
    if (response.status < 200 || response.status > 299) {
      return err(otherwise(response) ?? refused(response));
    }
    return ok(response);
  };

  /** GETs a path, decoding the answer with `schema`. */
  const get = async <T>(
    path: string,
    schema: z.ZodType<T>,
    signal: AbortSignal | undefined,
    otherwise?: (response: HttpResponse) => RemoteError | null,
  ) => {
    const answered = await ask({ method: "GET", path }, signal, otherwise);
    if (!answered.ok) return answered;
    const response = answered.value;
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
          remoteError("Jira's answer was not what XueFu expects", host, 200, {
            hint: "Is plugins.jira.url the address of Jira Data Center itself?",
          }),
        );
  };

  /** A 404 about an issue says it is not found, or not visible to the token's user. */
  const missing = (error: JiraFailure, key: string) =>
    err(
      error.kind === "remote" && error.status === 404
        ? notFound("issue", key, {
            hint: "Check the key, and that your token's user can see it.",
          })
        : error,
    );

  return {
    async search(jql, max, signal) {
      const query = new URLSearchParams({
        jql,
        maxResults: String(max),
        fields: LIST_FIELDS,
      });
      const found = await get(`/rest/api/2/search?${query}`, SearchSchema, signal, (response) =>
        response.status === 400
          ? remoteError(
              `Jira did not accept the query: ${jiraSays(response) ?? "it is not valid JQL"}`,
              host,
              400,
            )
          : null,
      );
      if (!found.ok) {
        // A query Jira rejects is a setting to fix, so it points at where it is set.
        return found.error.kind === "remote" && found.error.status === 400
          ? err(
              configurationError(found.error.message, source, [
                {
                  path: "plugins.jira.jql",
                  message: "fix the query, or remove it to use the default",
                },
              ]),
            )
          : found;
      }
      return ok({ issues: found.value.issues.map(toIssue), total: found.value.total });
    },

    async issue(key, signal) {
      const query = new URLSearchParams({ fields: ISSUE_FIELDS });
      const found = await get(
        `/rest/api/2/issue/${encodeURIComponent(key)}?${query}`,
        IssueSchema,
        signal,
      );
      if (!found.ok) return missing(found.error, key);
      return ok(toIssue(found.value));
    },

    async transitions(key, signal) {
      const found = await get(
        `/rest/api/2/issue/${encodeURIComponent(key)}/transitions`,
        TransitionsSchema,
        signal,
      );
      if (!found.ok) return missing(found.error, key);
      return ok(
        found.value.transitions.map((transition) => ({
          id: transition.id,
          name: transition.name,
          to: {
            name: transition.to.name,
            category: statusCategory(transition.to.statusCategory.key),
          },
        })),
      );
    },

    async transition(key, id, signal) {
      const moved = await ask(
        {
          method: "POST",
          path: `/rest/api/2/issue/${encodeURIComponent(key)}/transitions`,
          body: { transition: { id } },
        },
        signal,
        (response) =>
          response.status === 400
            ? remoteError(
                `Jira did not move ${key}${jiraSays(response) === null ? "" : `: ${jiraSays(response)}`}`,
                host,
                400,
                {
                  hint: "The move may ask for fields XueFu does not fill in; make it in Jira.",
                },
              )
            : null,
      );
      if (!moved.ok) return missing(moved.error, key);
      return ok(undefined);
    },

    browseUrl(key) {
      return `${url}/browse/${encodeURIComponent(key)}`;
    },
  };
}
