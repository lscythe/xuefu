import type { ConfirmationPrompt } from "../../domain/shared/confirmation";
import type { ProcessError } from "../../domain/shared/errors";
import type { AbsolutePath } from "../../domain/shared/path";
import type { Result } from "../../domain/shared/result";
import type { AppError } from "../errors";

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

/** A question for an agent, about the files in `cwd`. */
interface AgentQuestion {
  readonly cwd: AbsolutePath;
  readonly prompt: string;
}

/** What the cockpit does with an agent at work. */
export interface AgentHandlers {
  readonly onEvent: (event: AgentEvent) => void;
  /** Asks the user whether the agent may do something; resolves to their answer. */
  readonly approve: (prompt: ConfirmationPrompt) => Promise<boolean>;
}

/** Starts an agent on a question, with XueFu's tools, asking the user before any change. */
export interface AgentHost {
  /** The agent's name, as the user knows it, such as "Claude". */
  readonly name: string;
  ask(question: AgentQuestion, handlers: AgentHandlers): Result<AgentSession, AppError>;
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
