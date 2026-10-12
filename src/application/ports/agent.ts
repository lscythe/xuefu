import type { ConfirmationPrompt } from "../../domain/shared/confirmation";
import type { ProcessError } from "../../domain/shared/errors";
import type { AbsolutePath } from "../../domain/shared/path";
import type { Result } from "../../domain/shared/result";
import type { Workspace } from "../../domain/workspace/workspace";

/** Another MCP server the agent gets, run by it over stdio; every tool it has only reads. */
export interface AgentServer {
  /** Its name to the agent, so its tools are `mcp__<name>__<tool>`. */
  readonly name: string;
  readonly command: string;
  readonly args: readonly string[];
}

/** How to start a coding agent, such as Claude Code, on a question. */
export interface AgentLaunch {
  /** Where it works: the files it may read are here. */
  readonly cwd: AbsolutePath;
  /** The first message, as the user's. */
  readonly prompt: string;
  /** What the agent is told of where it runs, added to its own instructions. */
  readonly instructions: string;
  /** XueFu's tools, served over MCP's HTTP transport for this session alone. */
  readonly mcp: { readonly url: string; readonly token: string };
  /** XueFu's tools the agent may run without asking, those that only read. */
  readonly readTools: readonly string[];
  /** XueFu's tool the agent asks before using any other; it asks the user. */
  readonly approvalTool: string;
  /** Read-only servers it may also use freely, such as a code graph of the folder. */
  readonly servers: readonly AgentServer[];
}

/** What the agent does, as it does it. */
export type AgentEvent =
  /** It has started, on this model when it says. */
  | { readonly kind: "ready"; readonly model: string | null }
  /** Something it says. */
  | { readonly kind: "text"; readonly text: string }
  /** A tool it uses, by name, with what it passed. */
  | {
      readonly kind: "tool";
      readonly name: string;
      readonly input: Readonly<Record<string, unknown>>;
    }
  /** What XueFu does to prepare it, such as bringing the code graph up to date. */
  | { readonly kind: "step"; readonly text: string; readonly failed: boolean }
  /** Its answer to a message is complete; `failed` says why when it could not finish. */
  | { readonly kind: "turn"; readonly costUsd: number | null; readonly failed: string | null }
  /** It has stopped; `message` says why when it was not asked to. */
  | { readonly kind: "exit"; readonly message: string | null };

/** An agent at work: one conversation, until it is stopped. */
export interface AgentSession {
  /** Sends another message, as the user's, once the last is answered. */
  send(text: string): void;
  /** Stops the agent; it ends with an `exit` event. */
  stop(): void;
}

/** A question for an agent about a workspace. */
interface AgentQuestion {
  /**
   * The workspace the question is about, whose folder the agent works in; null when no workspace
   * holds the code, so the agent works from XueFu's tools alone.
   */
  readonly workspace: Workspace | null;
  /**
   * The first message. Null asks it only to study the workspace again, renewing what it keeps of
   * it, and to say what it learned.
   */
  readonly prompt: string | null;
}

/** A comment on a line of a pull request's diff, as the agent drafts it. */
export interface DraftComment {
  readonly file: string;
  /** The line, numbered as in the file after, or before for a removed line. */
  readonly line: number;
  /** On a removed line. */
  readonly old: boolean;
  readonly text: string;
  /** What the line should become, for the author to apply; null when it suggests no code. */
  readonly suggestion: string | null;
}

/** The comments the user and the agent settled on, to post on a pull request at once. */
export interface DraftReview {
  /** As `PROJECT/repository#id`. */
  readonly pullRequest: string;
  readonly comments: readonly DraftComment[];
}

/** What the cockpit does with an agent at work. */
export interface AgentHandlers {
  readonly onEvent: (event: AgentEvent) => void;
  /** Asks the user whether the agent may do something; resolves to their answer. */
  readonly approve: (prompt: ConfirmationPrompt) => Promise<boolean>;
  /** Shows the user a drafted review; resolves to the comments they chose to post, maybe none. */
  readonly review: (draft: DraftReview) => Promise<readonly DraftComment[]>;
}

/**
 * Starts an agent on a question, with XueFu's tools, asking the user before any change. It first
 * prepares what it knows of the workspace; anything that fails ends the session with a reason.
 */
export interface AgentHost {
  /** The agent's name, as the user knows it, such as "Claude". */
  readonly name: string;
  ask(question: AgentQuestion, handlers: AgentHandlers): AgentSession;
}

/** Starts a coding agent; fails when it cannot be run, such as when it is not installed. */
export interface AgentRunner {
  /** The agent's name, as the user knows it, such as "Claude". */
  readonly name: string;
  start(
    launch: AgentLaunch,
    onEvent: (event: AgentEvent) => void,
  ): Result<AgentSession, ProcessError>;
}
