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
const requests: { readonly url: string; readonly authorization: string | null }[] = [];
let server: ReturnType<typeof Bun.serve>;

beforeAll(() => {
  server = Bun.serve({
    port: 0,
    fetch: (request) => {
      requests.push({ url: request.url, authorization: request.headers.get("authorization") });
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
