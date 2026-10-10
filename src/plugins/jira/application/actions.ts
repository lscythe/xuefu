import { z } from "zod";
import { defineCommand } from "../../../application/commands/command";
import { domainString } from "../../../application/validation";
import { issueKey } from "../../../domain/work/issue-key";
import type { JiraClient } from "./jira-client";

/** What the Jira plugin changes in Jira, as commands on the bus. */
export function jiraActions(client: JiraClient) {
  const move = defineCommand({
    name: "jira.issue.move",
    title: "Move issue",
    category: "Jira",
    safety: "confirm",
    input: z.strictObject({
      key: domainString(issueKey),
      /** The workflow's id for the move. */
      transition: z.string().regex(/^\d{1,10}$/),
      /** The status it is in, and the one the move goes to, as Jira names them. */
      from: z.string().min(1).max(255),
      to: z.string().min(1).max(255),
    }),
    describe: (input) => ({
      title: `Move ${input.key}`,
      severity: "confirm",
      details: [
        { label: "Issue", value: input.key },
        { label: "From", value: input.from },
        { label: "To", value: input.to },
      ],
      consequence: `Moves ${input.key} to ${input.to} in Jira, where the team will see it.`,
      confirmLabel: "Move",
    }),
    handler: (input, context) => client.transition(input.key, input.transition, context.signal),
  });

  return { move };
}

export type JiraActions = ReturnType<typeof jiraActions>;
