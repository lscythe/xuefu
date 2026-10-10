import { lazy } from "solid-js";
import { z } from "zod";
import { SecretRefSchema } from "../../application/security/secret-ref";
import { definePlugin } from "../plugin";
import { jiraActions } from "./application/actions";
import { JIRA_COMMANDS, type JiraChanges, jiraCommands } from "./cli/commands";
import { MY_OPEN_ISSUES } from "./domain/issue";
import { jiraRest } from "./integrations/jira-rest";

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** Jira's address: HTTPS, but for a server on this machine; no trailing slash. */
const JiraUrl = z
  .url({ error: "must be Jira's address, such as https://jira.example.com" })
  .refine((raw) => {
    // Not an address at all is said by the check above.
    if (!URL.canParse(raw)) return true;
    const url = new URL(raw);
    return url.protocol === "https:" || (url.protocol === "http:" && LOOPBACK.has(url.hostname));
  }, "must use https, so the token is never sent in the clear")
  .transform((raw) => raw.replace(/\/+$/, ""));

const JiraSettings = z
  .strictObject({
    /** On once `url` is set, unless turned off. */
    enabled: z.boolean().optional(),
    url: JiraUrl.optional(),
    /** Where the personal access token is kept. */
    token: SecretRefSchema.optional(),
    /** Which issues to list; your open issues by default. */
    jql: z.string().trim().min(1).max(2000).default(MY_OPEN_ISSUES),
    maxResults: z.int().min(1).max(100).default(50),
    /** How often the Jira section reads the list again while it is open. */
    refreshSeconds: z.int().min(30).max(3600).default(120),
  })
  .transform((settings, ctx) => {
    const enabled = settings.enabled ?? settings.url !== undefined;
    if (!enabled) return { enabled: false } as const;
    const { url, token } = settings;
    if (url === undefined || token === undefined) {
      if (url === undefined) {
        ctx.addIssue({ code: "custom", path: ["url"], message: "set it to your Jira's address" });
      }
      if (token === undefined) {
        ctx.addIssue({
          code: "custom",
          path: ["token"],
          message: "say where the personal access token is kept, such as { env: JIRA_TOKEN }",
        });
      }
      return z.NEVER;
    }
    return { ...settings, enabled: true, url, token } as const;
  });

export const jiraPlugin = definePlugin({
  id: "jira",
  label: "Jira",
  icons: { nerd: "\u{e75c}", letter: "J" }, // dev-jira
  commands: JIRA_COMMANDS,
  settings: JiraSettings,
  whenOff: {
    message: "The Jira plugin is not set up",
    path: "plugins.jira.url",
    fix: "set url to your Jira's address, and token to where your personal access token is kept",
  },
  start: (context, settings, source) => {
    if (!settings.enabled) return {};
    const client = jiraRest({
      http: context.http,
      url: settings.url,
      token: () => context.secrets.resolve(settings.token),
      source,
    });
    const actions = jiraActions(client);
    const changes: JiraChanges = {
      client,
      startWork: context.core.startWork,
      invoke: (command, input, options) => context.bus.invoke(command, input, options),
      actions,
    };
    return {
      commands: jiraCommands(settings, changes),
      actions: [actions.move],
      view: lazy(async () => {
        const { jiraView } = await import("./tui/jira-view");
        return {
          default: jiraView({
            client,
            jql: settings.jql,
            maxResults: settings.maxResults,
            refreshMs: settings.refreshSeconds * 1000,
          }),
        };
      }),
    };
  },
});
