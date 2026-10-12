import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import type { HttpRequest } from "../../../../src/application/ports/http-client";
import { registerPluginActions } from "../../../../src/bootstrap/plugins";
import { ok } from "../../../../src/domain/shared/result";
import { prPlugin } from "../../../../src/plugins/pr/plugin";
import { fakeSecrets } from "../../../support/fake-secrets";
import { pluginContext } from "../../../support/plugin-context";

const start = (settings: unknown, context = pluginContext()) =>
  prPlugin.start(context, settings, "config.yml");

/** The paths and messages of what was wrong with the settings. */
const issues = (settings: unknown) => {
  const started = start(settings);
  return started.ok || started.error.kind !== "configuration"
    ? []
    : started.error.issues.map((issue) => [issue.path, issue.message]);
};

const URL = "https://bitbucket.example.com";
const TOKEN = { env: "BITBUCKET_TOKEN" };

describe("prPlugin settings", () => {
  test("off until it has an address, and says how to set it up", () => {
    expect(start({})).toEqual(ok(null));
    expect(start({ enabled: false, url: URL, token: TOKEN })).toEqual(ok(null));
    expect(prPlugin.whenOff).toMatchObject({ path: "plugins.pr.url" });
  });

  test("an address without a token, or the other way round, says what is missing", () => {
    expect(issues({ url: URL })).toEqual([
      [
        "plugins.pr.token",
        "say where the HTTP access token is kept, such as { env: BITBUCKET_TOKEN }",
      ],
    ]);
    expect(issues({ enabled: true, token: TOKEN })).toEqual([
      ["plugins.pr.url", "set it to your Bitbucket's address"],
    ]);
  });

  test("the address must be https; how much to read is bounded", () => {
    expect(issues({ url: "http://bitbucket.example.com", token: TOKEN })).toEqual([
      ["plugins.pr.url", "must use https, so the token is never sent in the clear"],
    ]);
    expect(issues({ url: URL, token: TOKEN, maxResults: 500 })[0]?.[0]).toBe(
      "plugins.pr.maxResults",
    );
    expect(issues({ url: URL, token: TOKEN, refreshSeconds: 5 })[0]?.[0]).toBe(
      "plugins.pr.refreshSeconds",
    );
  });

  test("set up, it asks Bitbucket with the token from where it is kept", async () => {
    const sent: HttpRequest[] = [];
    const started = start(
      { url: `${URL}/`, token: TOKEN, maxResults: 5 },
      pluginContext({
        secrets: fakeSecrets({ BITBUCKET_TOKEN: "bbdc-value" }),
        http: {
          request: (request) => {
            sent.push(request);
            return Promise.resolve(
              ok({
                status: 200,
                headers: {},
                body: JSON.stringify({ values: [], isLastPage: true }),
              }),
            );
          },
        },
      }),
    );
    let stderr = "";
    const shown = await (started.ok ? started.value : null)?.commands?.(
      { group: "pr", name: "list", args: [], flags: {} },
      {
        workspace: () => Promise.reject(new Error("not used")),
        stdout: () => undefined,
        stderr: (text) => {
          stderr += text;
        },
      },
    );
    expect(shown).toEqual(ok(1));
    expect(stderr).toContain("No open pull requests");
    expect(sent.map((request) => request.headers)).toEqual([
      { Authorization: "Bearer bbdc-value" },
      { Authorization: "Bearer bbdc-value" },
    ]);
    expect(new globalThis.URL(sent[0]?.url ?? "").searchParams.get("limit")).toBe("5");
  });

  test("its changes are commands on the bus, each asking first", () => {
    const context = pluginContext();
    const started = start({ url: URL, token: TOKEN }, context);
    const parts = started.ok ? started.value : null;
    if (parts === null) throw new Error("the plugin did not start");
    expect(registerPluginActions(context.bus, [{ plugin: prPlugin, parts }]).ok).toBe(true);
    expect(parts.actions?.map((action) => [action.name, action.safety])).toEqual([
      ["pr.review", "confirm"],
    ]);
  });

  test("a change from the CLI goes through the bus, which asks first", async () => {
    const pull = await Bun.file(
      join(import.meta.dir, "../../../contract/pr/fixtures/pull-request.json"),
    ).text();
    const sent: HttpRequest[] = [];
    const context = pluginContext({
      secrets: fakeSecrets({ BITBUCKET_TOKEN: "bbdc-value" }),
      http: {
        request: (request) => {
          sent.push(request);
          return Promise.resolve(ok({ status: 200, headers: {}, body: pull }));
        },
      },
    });
    const started = start({ url: URL, token: TOKEN }, context);
    const parts = started.ok ? started.value : null;
    if (parts === null) throw new Error("the plugin did not start");
    registerPluginActions(context.bus, [{ plugin: prPlugin, parts }]);
    const asked = await parts.commands?.(
      { group: "pr", name: "approve", args: ["MOB/mobile-banking#42"], flags: {} },
      {
        workspace: () => Promise.reject(new Error("not used")),
        stdout: () => undefined,
        stderr: () => undefined,
      },
    );
    expect(asked?.ok ? null : asked?.error.kind).toBe("confirmation-required");
    // Only the pull request was read; nothing was changed.
    expect(sent.map((request) => request.method)).toEqual(["GET"]);
  });
});
