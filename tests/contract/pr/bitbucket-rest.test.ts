import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import type { SecretFailure } from "../../../src/application/ports/secret-provider";
import { configurationError } from "../../../src/domain/shared/errors";
import { err, ok, type Result } from "../../../src/domain/shared/result";
import { type Secret, secret } from "../../../src/domain/shared/secret";
import { FetchHttpClient } from "../../../src/infrastructure/http/fetch-http-client";
import { bitbucketRest } from "../../../src/plugins/pr/integrations/bitbucket-rest";
import { testLogger } from "../../support/test-logger";

const fixture = (name: string) => Bun.file(join(import.meta.dir, "fixtures", `${name}.json`));

/** Each test says how the fake Bitbucket answers; requests are kept for checking what was sent. */
let answer: (request: Request) => Response | Promise<Response> = () => new Response("unset");
const requests: {
  readonly method: string;
  readonly url: string;
  readonly authorization: string | null;
  readonly body: string;
}[] = [];
let server: ReturnType<typeof Bun.serve>;

beforeAll(() => {
  server = Bun.serve({
    port: 0,
    fetch: async (request) => {
      requests.push({
        method: request.method,
        url: request.url,
        authorization: request.headers.get("authorization"),
        body: await request.text(),
      });
      return answer(request);
    },
  });
});
afterAll(() => {
  server.stop(true);
});

const TOKEN = "BBDC-NjQ4MzIxOTc0ODU2OkF4bXlwcmV0ZW5k";
const REPO = { project: "MOB", slug: "mobile-banking" };

function client(token: Result<Secret, SecretFailure> = ok(secret(TOKEN))) {
  return bitbucketRest({
    http: new FetchHttpClient(testLogger().logger, { sleep: () => Promise.resolve() }),
    url: `http://127.0.0.1:${server.port}`,
    token: () => Promise.resolve(token),
  });
}

const status =
  (code: number, body: unknown = {}, headers: Record<string, string> = {}) =>
  () =>
    Response.json(body, { status: code, headers });

describe("bitbucket REST 1.0: your pull requests", () => {
  test("asks the dashboard for open ones by role, with a bearer token, newest first", async () => {
    requests.length = 0;
    answer = () => new Response(fixture("dashboard"));
    const found = await client().mine("reviewer", 25);
    const sent = new URL(requests[0]?.url ?? "");
    expect(sent.pathname).toBe("/rest/api/1.0/dashboard/pull-requests");
    expect(Object.fromEntries(sent.searchParams)).toEqual({
      role: "REVIEWER",
      state: "OPEN",
      limit: "25",
    });
    expect(requests[0]?.authorization).toBe(`Bearer ${TOKEN}`);
    expect(found.ok && found.value.more).toBe(false);
    expect(found.ok && found.value.pullRequests.map((pull) => pull.id)).toEqual([42, 40]);
    expect(found.ok && found.value.pullRequests[1]).toEqual({
      repository: REPO,
      id: 40,
      version: 3,
      title: "MOB-2790 Fix crash when rotating the transfer screen",
      description: null,
      state: "open",
      from: "fix/MOB-2790-rotate-crash",
      to: "main",
      commit: "9c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d",
      author: "Fox Mulder",
      reviewers: [{ name: "Dana Scully", status: "needs-work" }],
      created: 1759650000000,
      updated: 1759700000000,
      comments: 5,
      openTodos: 0,
      conflicted: true,
      url: "https://bitbucket.example.com/projects/MOB/repos/mobile-banking/pull-requests/40",
    });
  });

  test("says when there are more than were asked for", async () => {
    answer = () => Response.json({ values: [], isLastPage: false, size: 0, limit: 1, start: 0 });
    const found = await client().mine("author", 1);
    expect(found).toEqual(ok({ pullRequests: [], more: true }));
  });
});

describe("bitbucket REST 1.0: one pull request", () => {
  test("reads it with its reviews, to-dos and merge outcome", async () => {
    requests.length = 0;
    answer = () => new Response(fixture("pull-request"));
    const found = await client().pullRequest(REPO, 42);
    expect(new URL(requests[0]?.url ?? "").pathname).toBe(
      "/rest/api/1.0/projects/MOB/repos/mobile-banking/pull-requests/42",
    );
    expect(found.ok && found.value).toMatchObject({
      title: "MOB-2841 Add biometric login",
      from: "feature/MOB-2841-biometric-login",
      reviewers: [
        { name: "Fox Mulder", status: "approved" },
        { name: "Walter Skinner", status: "unapproved" },
      ],
      comments: 3,
      openTodos: 1,
      conflicted: false,
      description:
        "Adds Face ID and fingerprint unlock.\n\n- Falls back to the PIN\n- Behind the `biometrics` flag",
    });
  });

  test("one that is not there, or not readable, is not found", async () => {
    answer = status(404, {
      errors: [{ message: "Pull request 9 does not exist in MOB/mobile-banking." }],
    });
    const found = await client().pullRequest(REPO, 9);
    expect(found.ok ? null : found.error).toMatchObject({
      kind: "not-found",
      entity: "pull request",
      key: "MOB/mobile-banking#9",
    });
  });

  test("the open one from a branch, or none", async () => {
    requests.length = 0;
    answer = () => new Response(fixture("dashboard"));
    const found = await client().forBranch(REPO, "fix/MOB-2790-rotate-crash");
    const sent = new URL(requests[0]?.url ?? "");
    expect(sent.pathname).toBe("/rest/api/1.0/projects/MOB/repos/mobile-banking/pull-requests");
    expect(Object.fromEntries(sent.searchParams)).toEqual({
      at: "refs/heads/fix/MOB-2790-rotate-crash",
      direction: "OUTGOING",
      state: "OPEN",
      limit: "1",
    });
    expect(found.ok && found.value?.id).toBe(40);
    answer = () => Response.json({ values: [], isLastPage: true });
    expect(await client().forBranch(REPO, "spike")).toEqual(ok(null));
  });

  test("its builds, by how they ended", async () => {
    requests.length = 0;
    answer = () => new Response(fixture("build-stats"));
    const builds = await client().builds("4b8e2c9f");
    expect(new URL(requests[0]?.url ?? "").pathname).toBe(
      "/rest/build-status/1.0/commits/stats/4b8e2c9f",
    );
    expect(builds).toEqual(ok({ successful: 2, failed: 1, inProgress: 0 }));
  });
});

/** Answers by path; any other path is not found. */
const byPath =
  (answers: Record<string, () => Response>) =>
  (request: Request): Response =>
    answers[new URL(request.url).pathname]?.() ?? Response.json({}, { status: 404 });

describe("bitbucket REST 1.0: reviews", () => {
  const PARTICIPANT =
    "/rest/api/1.0/projects/MOB/repos/mobile-banking/pull-requests/42/participants";
  const signedIn = (name: string) => () =>
    Response.json({ version: "9.4.0" }, { headers: { "X-AUSERNAME": name } });
  const users = () =>
    Response.json({
      values: [
        { name: "dscully2", slug: "dscully2" },
        { name: "Dana.Scully@fbi.gov", slug: "dana.scully_fbi.gov" },
      ],
      isLastPage: true,
    });

  test("sets your status, of the commit that was seen, as the user the token signs in", async () => {
    requests.length = 0;
    answer = byPath({
      "/rest/api/1.0/application-properties": signedIn("Dana.Scully@fbi.gov"),
      "/rest/api/1.0/users": users,
      [`${PARTICIPANT}/dana.scully_fbi.gov`]: () => Response.json({ status: "APPROVED" }),
    });
    const bitbucket = client();
    expect(await bitbucket.review(REPO, 42, "approved", "4b8e2c9f")).toEqual(ok(undefined));
    expect(await bitbucket.review(REPO, 42, "needs-work", "4b8e2c9f")).toEqual(ok(undefined));
    expect(requests.map((sent) => `${sent.method} ${new URL(sent.url).pathname}`)).toEqual([
      "GET /rest/api/1.0/application-properties",
      "GET /rest/api/1.0/users",
      `PUT ${PARTICIPANT}/dana.scully_fbi.gov`,
      // Who the token is was read once.
      `PUT ${PARTICIPANT}/dana.scully_fbi.gov`,
    ]);
    expect(new URL(requests[1]?.url ?? "").searchParams.get("filter")).toBe("Dana.Scully@fbi.gov");
    expect(requests.slice(2).map((sent) => JSON.parse(sent.body))).toEqual([
      { status: "APPROVED", lastReviewedCommit: "4b8e2c9f" },
      { status: "NEEDS_WORK", lastReviewedCommit: "4b8e2c9f" },
    ]);
    expect(requests.every((sent) => sent.authorization === `Bearer ${TOKEN}`)).toBe(true);
  });

  test("withdrawing a review sets you unapproved", async () => {
    requests.length = 0;
    answer = byPath({
      "/rest/api/1.0/application-properties": signedIn("dscully2"),
      "/rest/api/1.0/users": users,
      [`${PARTICIPANT}/dscully2`]: () => Response.json({ status: "UNAPPROVED" }),
    });
    expect(await client().review(REPO, 42, "unapproved", "4b8e2c9f")).toEqual(ok(undefined));
    expect(JSON.parse(requests.at(-1)?.body ?? "")).toMatchObject({ status: "UNAPPROVED" });
  });

  test("what Bitbucket says when it refuses, such as on your own pull request", async () => {
    answer = byPath({
      "/rest/api/1.0/application-properties": signedIn("dscully2"),
      "/rest/api/1.0/users": users,
      [`${PARTICIPANT}/dscully2`]: status(400, {
        errors: [{ message: "Authors cannot review their own pull request." }],
      }),
    });
    const refused = await client().review(REPO, 42, "approved", "4b8e2c9f");
    expect(refused.ok ? null : refused.error.message).toBe(
      "Bitbucket answered 400: Authors cannot review their own pull request.",
    );
  });

  test("a pull request that is not there is not found", async () => {
    answer = byPath({
      "/rest/api/1.0/application-properties": signedIn("dscully2"),
      "/rest/api/1.0/users": users,
    });
    const missing = await client().review(REPO, 42, "approved", "4b8e2c9f");
    expect(missing.ok ? null : missing.error).toMatchObject({
      kind: "not-found",
      key: "MOB/mobile-banking#42",
    });
  });

  test("an answer that does not say who signed in is a failure, and nothing is changed", async () => {
    requests.length = 0;
    answer = byPath({
      "/rest/api/1.0/application-properties": () => Response.json({ version: "9.4.0" }),
    });
    const unknown = await client().review(REPO, 42, "approved", "4b8e2c9f");
    expect(unknown.ok ? null : unknown.error.message).toBe(
      "Bitbucket did not say whose the token is",
    );
    expect(requests.map((sent) => sent.method)).toEqual(["GET"]);
  });
});

describe("bitbucket REST 1.0: merging", () => {
  const MERGE = "/rest/api/1.0/projects/MOB/repos/mobile-banking/pull-requests/42/merge";

  test("whether it can be merged, and what stands in the way", async () => {
    requests.length = 0;
    answer = () =>
      Response.json({
        canMerge: false,
        conflicted: true,
        outcome: "CONFLICTED",
        vetoes: [
          {
            summaryMessage: "Requires 2 approvals",
            detailedMessage: "You need 2 approvals before this pull request can be merged.",
          },
        ],
      });
    expect(await client().mergeability(REPO, 42)).toEqual(
      ok({ canMerge: false, conflicted: true, vetoes: ["Requires 2 approvals"] }),
    );
    expect(`${requests[0]?.method} ${new URL(requests[0]?.url ?? "").pathname}`).toBe(
      `GET ${MERGE}`,
    );
    answer = () =>
      Response.json({ canMerge: true, conflicted: false, outcome: "CLEAN", vetoes: [] });
    expect(await client().mergeability(REPO, 42)).toEqual(
      ok({ canMerge: true, conflicted: false, vetoes: [] }),
    );
  });

  test("merges it at the version that was read, answering with the merged pull request", async () => {
    requests.length = 0;
    const merged = { ...(await fixture("pull-request").json()), state: "MERGED" };
    answer = () => Response.json(merged);
    const done = await client().merge(REPO, 42, 3);
    const sent = new URL(requests[0]?.url ?? "");
    expect(`${requests[0]?.method} ${sent.pathname}`).toBe(`POST ${MERGE}`);
    expect(sent.searchParams.get("version")).toBe("3");
    expect(JSON.parse(requests[0]?.body ?? "")).toEqual({});
    expect(done.ok && done.value.state).toBe("merged");
  });

  test("a refused merge says what Bitbucket and its merge checks said", async () => {
    answer = status(409, {
      errors: [
        {
          message: "Merging the pull request has been vetoed.",
          vetoes: [
            { summaryMessage: "Requires 2 approvals", detailedMessage: "..." },
            {
              summaryMessage: "Not all required builds are successful yet",
              detailedMessage: "...",
            },
          ],
        },
      ],
    });
    const refused = await client().merge(REPO, 42, 3);
    expect(refused.ok ? null : refused.error).toMatchObject({
      kind: "remote",
      status: 409,
      message:
        "Bitbucket answered 409: Merging the pull request has been vetoed. (Requires 2 approvals; Not all required builds are successful yet)",
    });
    answer = status(404);
    const missing = await client().mergeability(REPO, 42);
    expect(missing.ok ? null : missing.error.kind).toBe("not-found");
  });
});

describe("bitbucket REST 1.0: the diff", () => {
  test("streams it raw, with three lines of context as git shows", async () => {
    requests.length = 0;
    const raw = "diff --git a/a.txt b/a.txt\n--- a/a.txt\n+++ b/a.txt\n@@ -1 +1 @@\n-a\n+b\n";
    answer = () => new Response(raw, { headers: { "Content-Type": "text/plain" } });
    expect(await client().diff(REPO, 42)).toEqual(ok(raw));
    const sent = new URL(requests[0]?.url ?? "");
    expect(sent.pathname).toBe(
      "/rest/api/1.0/projects/MOB/repos/mobile-banking/pull-requests/42.diff",
    );
    expect(sent.searchParams.get("contextLines")).toBe("3");
  });

  test("one larger than the default limit on answers is still read", async () => {
    const line = `+${"x".repeat(99)}\n`;
    const raw = `--- a/big\n+++ b/big\n@@ -0,0 +1,60000 @@\n${line.repeat(60_000)}`;
    answer = () => new Response(raw);
    const read = await client().diff(REPO, 42);
    expect(read.ok && read.value.length).toBe(raw.length);
  });

  test("a pull request that is not there is not found", async () => {
    answer = status(404, { errors: [{ message: "No such pull request" }] });
    const missing = await client().diff(REPO, 9);
    expect(missing.ok ? null : missing.error).toMatchObject({
      kind: "not-found",
      key: "MOB/mobile-banking#9",
    });
  });
});

describe("bitbucket REST 1.0: comments", () => {
  const ACTIVITIES = "/rest/api/1.0/projects/MOB/repos/mobile-banking/pull-requests/42/activities";
  const LAST_PAGE = {
    isLastPage: true,
    values: [
      {
        action: "COMMENTED",
        commentAction: "ADDED",
        commentAnchor: {
          path: "README.md",
          line: 3,
          lineType: "REMOVED",
          fileType: "FROM",
          orphaned: true,
        },
        comment: {
          id: 99,
          text: "Why remove this?",
          author: { displayName: "Monica Reyes" },
          createdDate: 1759700000000,
          updatedDate: 1759700000000,
          comments: [],
        },
      },
    ],
  };

  test("threads from every page of activities, oldest first, each with its replies", async () => {
    requests.length = 0;
    const first = await fixture("activities").json();
    answer = (request) =>
      Response.json(new URL(request.url).searchParams.get("start") === "6" ? LAST_PAGE : first);
    const read = await client().comments(REPO, 42);
    expect(
      requests.map((sent) => {
        const url = new URL(sent.url);
        return [url.pathname, url.searchParams.get("start"), url.searchParams.get("limit")];
      }),
    ).toEqual([
      [ACTIVITIES, "0", "100"],
      [ACTIVITIES, "6", "100"],
    ]);
    expect(read).toEqual(
      ok([
        {
          id: 99,
          version: 0,
          author: "Monica Reyes",
          text: "Why remove this?",
          created: 1759700000000,
          updated: 1759700000000,
          anchor: { path: "README.md", line: 3, side: "old", lineKind: "removed", outdated: true },
          todo: null,
          resolved: false,
          replies: [],
        },
        {
          id: 101,
          version: 2,
          author: "Fox Mulder",
          text: "Looks good overall.\n\nOne question below.",
          created: 1759720000000,
          updated: 1759725000000,
          anchor: null,
          todo: null,
          resolved: true,
          replies: [],
        },
        {
          id: 102,
          version: 0,
          author: "Fox Mulder",
          text: "Shouldn't this fall back to the PIN?",
          created: 1759730000000,
          updated: 1759730000000,
          anchor: {
            path: "app/src/Login.kt",
            line: 11,
            side: "new",
            lineKind: "added",
            outdated: false,
          },
          todo: "open",
          resolved: false,
          replies: [
            {
              id: 105,
              version: 0,
              author: "Dana Scully",
              text: "It does, after three tries.",
              created: 1759760000000,
              updated: 1759760000000,
              anchor: null,
              todo: null,
              resolved: false,
              replies: [],
            },
          ],
        },
      ]),
    );
  });

  test("none, and a pull request that is not there", async () => {
    answer = () => Response.json({ isLastPage: true, values: [] });
    expect(await client().comments(REPO, 42)).toEqual(ok([]));
    answer = status(404);
    const missing = await client().comments(REPO, 9);
    expect(missing.ok ? null : missing.error.kind).toBe("not-found");
  });
});

describe("bitbucket REST 1.0: refusals", () => {
  test.each([
    [401, {}, "Bitbucket did not accept the token", "HTTP access token"],
    [403, {}, "Bitbucket refused the request", "read access"],
    [
      403,
      { "X-Authentication-Denied-Reason": "CAPTCHA_CHALLENGE" },
      "Bitbucket refused the request",
      "CAPTCHA",
    ],
    [429, {}, "Bitbucket is limiting how often XueFu may ask", "refreshSeconds"],
  ])("%i %o", async (code, headers, message, hint) => {
    answer = status(code, {}, headers);
    const found = await client().pullRequest(REPO, 42);
    expect(found.ok ? null : found.error).toMatchObject({ kind: "remote", status: code, message });
    expect(found.ok ? "" : (found.error.hint ?? "")).toContain(hint);
  });

  test("another failure says what Bitbucket said", async () => {
    answer = status(500, { errors: [{ message: "Database is unavailable" }] });
    const found = await client().mine("author", 1);
    expect(found.ok ? null : found.error.message).toBe(
      "Bitbucket answered 500: Database is unavailable",
    );
  });

  test("an answer of the wrong shape asks whether the address is Bitbucket", async () => {
    answer = () => new Response("<html>Sign in</html>");
    const found = await client().mine("author", 1);
    expect(found.ok ? null : found.error).toMatchObject({
      kind: "remote",
      message: "Bitbucket's answer was not what XueFu expects",
    });
  });

  test("no token, no request; and the token never appears in an error", async () => {
    requests.length = 0;
    const missing = configurationError("BITBUCKET_TOKEN is not set", "environment", []);
    expect(await client(err(missing)).mine("author", 1)).toEqual(err(missing));
    expect(requests).toEqual([]);
    answer = status(401);
    expect(JSON.stringify(await client().mine("author", 1))).not.toContain(TOKEN);
  });
});
