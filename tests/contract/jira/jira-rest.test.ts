import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import type { SecretFailure } from "../../../src/application/ports/secret-provider";
import { configurationError } from "../../../src/domain/shared/errors";
import { err, ok, type Result } from "../../../src/domain/shared/result";
import { type Secret, secret } from "../../../src/domain/shared/secret";
import { FetchHttpClient } from "../../../src/infrastructure/http/fetch-http-client";
import { jiraRest, jiraTime } from "../../../src/plugins/jira/integrations/jira-rest";
import { testLogger } from "../../support/test-logger";

const fixture = (name: string) => Bun.file(join(import.meta.dir, "fixtures", `${name}.json`));

/** Each test says how the fake Jira answers; requests are kept for checking what was sent. */
let answer: (request: Request) => Response | Promise<Response> = () => new Response("unset");
/** What the fake Jira was sent; a Request itself is not readable once it has been answered. */
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
        body: await request.clone().text(),
      });
      return answer(request);
    },
  });
});
afterAll(() => {
  server.stop(true);
});

const TOKEN = "pat-NjQ4MzIxOTc0ODU2OkF4";

function client(token: Result<Secret, SecretFailure> = ok(secret(TOKEN))) {
  return jiraRest({
    http: new FetchHttpClient(testLogger().logger, { sleep: () => Promise.resolve() }),
    url: `http://127.0.0.1:${server.port}`,
    token: () => Promise.resolve(token),
    source: "/home/dana/.config/xuefu/config.yml",
  });
}

const status =
  (code: number, body: unknown = {}, headers: Record<string, string> = {}) =>
  () =>
    Response.json(body, { status: code, headers });

describe("jira REST v2: search", () => {
  test("asks for the JQL with a bearer token and decodes each issue", async () => {
    requests.length = 0;
    answer = () => new Response(fixture("search"));
    const found = await client().search("project = MOB", 2);
    const sent = new URL(requests[0]?.url ?? "");
    expect(sent.pathname).toBe("/rest/api/2/search");
    expect(sent.searchParams.get("jql")).toBe("project = MOB");
    expect(sent.searchParams.get("maxResults")).toBe("2");
    expect(sent.searchParams.get("fields")).toBe(
      "summary,status,issuetype,priority,assignee,reporter,created,updated",
    );
    expect(requests[0]?.authorization).toBe(`Bearer ${TOKEN}`);
    expect(found.ok && found.value.total).toBe(7);
    expect(found.ok && found.value.issues).toEqual([
      {
        key: "MOB-2841",
        summary: "Add biometric login",
        status: { name: "In Progress", category: "doing" },
        type: "Story",
        priority: "High",
        assignee: "Dana Scully",
        reporter: "Fox Mulder",
        created: Date.parse("2026-10-01T07:12:03Z"),
        updated: Date.parse("2026-10-06T11:59:41Z"),
        description: null,
      },
      {
        key: "MOB-2790",
        summary: "Session times out during payment",
        status: { name: "Selected for Development", category: "todo" },
        type: "Bug",
        priority: null,
        assignee: null,
        reporter: "Walter Skinner",
        created: Date.parse("2026-09-22T20:40:00Z"),
        updated: Date.parse("2026-10-05T12:03:12Z"),
        description: null,
      },
    ]);
  });

  test("a query Jira rejects points at the setting to fix", async () => {
    answer = status(400, { errorMessages: ["Field 'asignee' does not exist."], errors: {} });
    const found = await client().search("asignee = me", 10);
    expect(found).toEqual(
      err(
        configurationError(
          "Jira did not accept the query: Field 'asignee' does not exist.",
          "/home/dana/.config/xuefu/config.yml",
          [{ path: "plugins.jira.jql", message: "fix the query, or remove it to use the default" }],
        ),
      ),
    );
  });

  test("a rate limit is waited out, then given up on with advice", async () => {
    let calls = 0;
    answer = () => {
      calls += 1;
      return calls === 1
        ? new Response("", { status: 429, headers: { "Retry-After": "1" } })
        : new Response(fixture("search"));
    };
    expect((await client().search("x", 2)).ok).toBe(true);
    answer = status(429);
    const limited = await client().search("x", 2);
    expect(limited.ok ? null : limited.error).toMatchObject({ kind: "remote", status: 429 });
  });
});

describe("jira REST v2: issue", () => {
  test("reads one issue with its description, ignoring fields XueFu does not use", async () => {
    requests.length = 0;
    answer = () => new Response(fixture("issue"));
    const found = await client().issue("MOB-2841");
    expect(new URL(requests[0]?.url ?? "").pathname).toBe("/rest/api/2/issue/MOB-2841");
    expect(found.ok && found.value).toMatchObject({
      key: "MOB-2841",
      description:
        "h3. Acceptance criteria\n* Face ID and fingerprint unlock the app\n* Falls back to the PIN",
    });
  });

  test("an issue that is not there, or not visible, is not found", async () => {
    answer = status(404, { errorMessages: ["Issue Does Not Exist"], errors: {} });
    const found = await client().issue("MOB-1");
    expect(found.ok ? null : found.error).toMatchObject({
      kind: "not-found",
      entity: "issue",
      key: "MOB-1",
    });
  });

  test("the browse address is the issue's page", () => {
    expect(client().browseUrl("MOB-2841")).toBe(`http://127.0.0.1:${server.port}/browse/MOB-2841`);
  });
});

describe("jira REST v2: transitions", () => {
  test("lists the moves the workflow allows, with where each goes", async () => {
    requests.length = 0;
    answer = () => new Response(fixture("transitions"));
    const found = await client().transitions("MOB-2841");
    expect(new URL(requests[0]?.url ?? "").pathname).toBe("/rest/api/2/issue/MOB-2841/transitions");
    expect(found).toEqual(
      ok([
        { id: "11", name: "Start Progress", to: { name: "In Progress", category: "doing" } },
        { id: "31", name: "Done", to: { name: "Done", category: "done" } },
      ]),
    );
  });

  test("moves the issue by posting the transition's id once", async () => {
    requests.length = 0;
    answer = () => new Response(null, { status: 204 });
    expect(await client().transition("MOB-2841", "11")).toEqual(ok(undefined));
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      method: "POST",
      authorization: `Bearer ${TOKEN}`,
    });
    expect(new URL(requests[0]?.url ?? "").pathname).toBe("/rest/api/2/issue/MOB-2841/transitions");
    expect(JSON.parse(requests[0]?.body ?? "")).toEqual({ transition: { id: "11" } });
  });

  test("a move the workflow refuses says why, and to make it in Jira", async () => {
    requests.length = 0;
    answer = status(400, { errorMessages: [], errors: { resolution: "Resolution is required." } });
    const moved = await client().transition("MOB-2841", "31");
    expect(moved.ok ? null : moved.error).toMatchObject({
      kind: "remote",
      status: 400,
      message: "Jira did not move MOB-2841: Resolution is required.",
    });
    expect(moved.ok ? "" : moved.error.hint).toContain("make it in Jira");
    // A change is never sent twice.
    answer = status(503);
    requests.length = 0;
    await client().transition("MOB-2841", "11");
    expect(requests).toHaveLength(1);
  });

  test("an issue that is not there is not found, for its moves as for itself", async () => {
    answer = status(404, { errorMessages: ["Issue Does Not Exist"] });
    const moves = await client().transitions("MOB-1");
    expect(moves.ok ? null : moves.error.kind).toBe("not-found");
    const moved = await client().transition("MOB-1", "11");
    expect(moved.ok ? null : moved.error.kind).toBe("not-found");
  });
});

describe("jira REST v2: refusals", () => {
  test.each([
    [401, {}, "Jira did not accept the token", "personal access token"],
    [403, {}, "Jira refused the request", "may not be allowed"],
    [
      403,
      { "X-Authentication-Denied-Reason": "CAPTCHA_CHALLENGE" },
      "Jira refused the request",
      "CAPTCHA",
    ],
  ])("%i %o", async (code, headers, message, hint) => {
    answer = status(code, {}, headers);
    const found = await client().issue("MOB-2841");
    expect(found.ok ? null : found.error).toMatchObject({ kind: "remote", status: code, message });
    expect(found.ok ? "" : (found.error.hint ?? "")).toContain(hint);
  });

  test("another failure says what Jira said", async () => {
    answer = status(500, { errorMessages: ["Index is being rebuilt"] });
    const found = await client().search("x", 1);
    expect(found.ok ? null : found.error.message).toBe("Jira answered 500: Index is being rebuilt");
  });

  test("an answer of the wrong shape asks whether the address is Jira", async () => {
    answer = () => new Response("<html>Sign in</html>");
    const found = await client().search("x", 1);
    expect(found.ok ? null : found.error).toMatchObject({
      kind: "remote",
      message: "Jira's answer was not what XueFu expects",
    });
  });

  test("no token, no request", async () => {
    requests.length = 0;
    const missing = configurationError("JIRA_TOKEN is not set", "environment", []);
    expect(await client(err(missing)).search("x", 1)).toEqual(err(missing));
    expect(requests).toEqual([]);
  });

  test("the token never appears in an error", async () => {
    answer = status(401);
    const found = await client().search("x", 1);
    expect(JSON.stringify(found)).not.toContain(TOKEN);
  });
});

describe("jiraTime", () => {
  test("reads Jira's offsets", () => {
    expect(jiraTime("2026-10-06T13:59:41.000+0200")).toBe(Date.parse("2026-10-06T11:59:41Z"));
    expect(jiraTime("2026-10-06T13:59:41.000Z")).toBe(Date.parse("2026-10-06T13:59:41Z"));
  });
});
