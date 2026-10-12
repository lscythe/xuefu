import { lazy } from "solid-js";
import { z } from "zod";
import { SecretRefSchema } from "../../application/security/secret-ref";
import { serviceUrlSchema } from "../../application/security/service-url";
import { definePlugin } from "../plugin";
import { type PrChanges, prActions } from "./application/actions";
import { PR_COMMANDS, prCommands } from "./cli/commands";
import { bitbucketRest } from "./integrations/bitbucket-rest";
import { gitCheckout } from "./integrations/git-checkout";

const PrSettings = z
  .strictObject({
    /** On once `url` is set, unless turned off. */
    enabled: z.boolean().optional(),
    url: serviceUrlSchema("Bitbucket", "https://bitbucket.example.com").optional(),
    /** Where the HTTP access token is kept. */
    token: SecretRefSchema.optional(),
    /** How many of each list to read. */
    maxResults: z.int().min(1).max(100).default(25),
    /** How often the pull requests section reads them again while it is open. */
    refreshSeconds: z.int().min(30).max(3600).default(60),
  })
  .transform((settings, ctx) => {
    const enabled = settings.enabled ?? settings.url !== undefined;
    if (!enabled) return { enabled: false } as const;
    const { url, token } = settings;
    if (url === undefined || token === undefined) {
      if (url === undefined) {
        ctx.addIssue({
          code: "custom",
          path: ["url"],
          message: "set it to your Bitbucket's address",
        });
      }
      if (token === undefined) {
        ctx.addIssue({
          code: "custom",
          path: ["token"],
          message: "say where the HTTP access token is kept, such as { env: BITBUCKET_TOKEN }",
        });
      }
      return z.NEVER;
    }
    return { ...settings, enabled: true, url, token } as const;
  });

/** Pull requests on Bitbucket Data Center or Server. */
export const prPlugin = definePlugin({
  id: "pr",
  label: "PRs",
  icons: { nerd: "\u{e726}", letter: "P" }, // dev-git_pull_request
  commands: PR_COMMANDS,
  settings: PrSettings,
  whenOff: {
    message: "The pull requests plugin is not set up",
    path: "plugins.pr.url",
    fix: "set url to your Bitbucket's address, and token to where your HTTP access token is kept",
  },
  start: (context, settings) => {
    if (!settings.enabled) return {};
    const client = bitbucketRest({
      http: context.http,
      url: settings.url,
      token: () => context.secrets.resolve(settings.token),
    });
    const actions = prActions(client);
    const changes: PrChanges = {
      client,
      checkouts: gitCheckout(context.processes),
      host: new URL(settings.url).hostname,
      invoke: (command, input, options) => context.bus.invoke(command, input, options),
      actions,
    };
    return {
      commands: prCommands(changes, settings.maxResults),
      actions: [actions.review, actions.merge, actions.comment],
      view: lazy(async () => {
        const { prView } = await import("./tui/pr-view");
        return {
          default: prView({
            ...changes,
            maxResults: settings.maxResults,
            refreshMs: settings.refreshSeconds * 1000,
          }),
        };
      }),
    };
  },
});
