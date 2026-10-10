import { describe, expect, test } from "bun:test";
import { CommandBus } from "../../../../src/application/commands/command-bus";
import type { HttpRequest } from "../../../../src/application/ports/http-client";
import { ok } from "../../../../src/domain/shared/result";
import { jiraPlugin } from "../../../../src/plugins/jira/plugin";
import type { PluginContext } from "../../../../src/plugins/plugin";
import { fakeSecrets } from "../../../support/fake-secrets";
import { ManualClock } from "../../../support/manual-clock";
import { SequentialIds } from "../../../support/sequential-ids";
import { testLogger } from "../../../support/test-logger";

function context(overrides: Partial<PluginContext> = {}): PluginContext {
  const logger = testLogger().logger;
  const clock = new ManualClock();
  return {
    bus: new CommandBus({ logger, clock, ids: new SequentialIds() }),
    processes: { run: () => Promise.reject(new Error("jira runs no programs")) },
    http: { request: () => Promise.reject(new Error("not in these tests")) },
    secrets: fakeSecrets(),
    logger,
    clock,
    ...overrides,
  };
}

const start = (settings: unknown) => jiraPlugin.start(context(), settings, "config.yml");

/** The paths and messages of what was wrong with the settings. */
const issues = (settings: unknown) => {
  const started = start(settings);
  return started.ok || started.error.kind !== "configuration"
    ? []
    : started.error.issues.map((issue) => [issue.path, issue.message]);
};

const URL = "https://jira.example.com";
const TOKEN = { env: "JIRA_TOKEN" };

describe("jiraPlugin settings", () => {
  test("off until it has an address, and says how to set it up", () => {
    expect(start({})).toEqual({ ok: true, value: null });
    expect(start({ enabled: false, url: URL, token: TOKEN })).toEqual({ ok: true, value: null });
    expect(jiraPlugin.whenOff).toMatchObject({ path: "plugins.jira.url" });
  });

  test("on with an address and a token, from the environment or the keychain", () => {
    for (const token of [TOKEN, { keychain: { service: "jira", account: "dana" } }]) {
      const started = start({ url: `${URL}/`, token });
      expect(started.ok && started.value?.commands !== undefined).toBe(true);
    }
  });

  test("an address without a token, or the other way round, says what is missing", () => {
    expect(issues({ url: URL })).toEqual([
      [
        "plugins.jira.token",
        "say where the personal access token is kept, such as { env: JIRA_TOKEN }",
      ],
    ]);
    expect(issues({ enabled: true, token: TOKEN })).toEqual([
      ["plugins.jira.url", "set it to your Jira's address"],
    ]);
  });

  test("a token pasted into config is refused, pointing at how to keep it", () => {
    expect(issues({ url: URL, token: "NjQ4MzIxOTc0ODU2OkF4" })).toEqual([
      [
        "plugins.jira.token",
        "must say where the credential is kept, as { env: NAME } or { keychain: { service, account } }, never the credential itself",
      ],
    ]);
    expect(issues({ url: URL, token: { env: "not a name" } })[0]?.[1]).toBe(
      "must be an environment variable's name, such as JIRA_TOKEN",
    );
  });

  test("the address must be https, unless Jira runs on this machine", () => {
    expect(issues({ url: "http://jira.example.com", token: TOKEN })).toEqual([
      ["plugins.jira.url", "must use https, so the token is never sent in the clear"],
    ]);
    expect(issues({ url: "http://localhost:8080", token: TOKEN })).toEqual([]);
    expect(issues({ url: "jira", token: TOKEN })[0]?.[1]).toBe(
      "must be Jira's address, such as https://jira.example.com",
    );
  });

  test("the section reads Jira every half minute to an hour, every two minutes by default", () => {
    expect(issues({ url: URL, token: TOKEN, refreshSeconds: 10 })).toEqual([
      ["plugins.jira.refreshSeconds", "Too small: expected number to be >=30"],
    ]);
    const started = start({ url: URL, token: TOKEN, refreshSeconds: 3600 });
    expect(started.ok && started.value?.view !== undefined).toBe(true);
  });

  test("unknown settings are refused, catching typos", () => {
    expect(issues({ url: URL, token: TOKEN, jqll: "x" })[0]?.[0]).toBe("plugins.jira");
  });
});

describe("jiraPlugin commands", () => {
  const settings = { url: URL, token: TOKEN, jql: "project = MOB", maxResults: 5 };
  const io = () => {
    const out = { stdout: "", stderr: "" };
    return {
      out,
      io: {
        workspace: () => Promise.reject(new Error("jira needs no workspace")),
        stdout: (text: string) => {
          out.stdout += text;
        },
        stderr: (text: string) => {
          out.stderr += text;
        },
      },
    };
  };

  test("ask Jira with the token from where it is kept, and the configured query", async () => {
    const sent: HttpRequest[] = [];
    const started = jiraPlugin.start(
      context({
        secrets: fakeSecrets({ JIRA_TOKEN: "pat-value" }),
        http: {
          request: (request) => {
            sent.push(request);
            return Promise.resolve(
              ok({ status: 200, headers: {}, body: JSON.stringify({ issues: [], total: 0 }) }),
            );
          },
        },
      }),
      settings,
      "config.yml",
    );
    const commands = started.ok ? started.value?.commands : undefined;
    const { out, io: streams } = io();
    expect(
      await commands?.({ group: "jira", name: "issues", args: [], flags: {} }, streams),
    ).toEqual(ok(1));
    expect(sent[0]?.headers).toEqual({ Authorization: "Bearer pat-value" });
    const asked = new globalThis.URL(sent[0]?.url ?? "");
    expect(asked.origin + asked.pathname).toBe(`${URL}/rest/api/2/search`);
    expect(asked.searchParams.get("jql")).toBe("project = MOB");
    expect(asked.searchParams.get("maxResults")).toBe("5");
    expect(out.stderr).toBe("No issues match: project = MOB\n");
  });

  test("a token that is not where it is said to be fails before asking Jira", async () => {
    const started = jiraPlugin.start(context(), settings, "config.yml");
    const commands = started.ok ? started.value?.commands : undefined;
    const shown = await commands?.({ group: "jira", name: "issues", args: [], flags: {} }, io().io);
    expect(shown?.ok ? null : shown?.error.kind).toBe("configuration");
  });
});
