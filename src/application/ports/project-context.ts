import type { FileSystemError } from "../../domain/shared/errors";
import type { WorkspaceId } from "../../domain/shared/ids";
import type { AbsolutePath } from "../../domain/shared/path";
import type { Result } from "../../domain/shared/result";
import type { Timestamp } from "../../domain/shared/time";
import type { Workspace } from "../../domain/workspace/workspace";
import type { AgentServer } from "./agent";
import type { ProcessFailure } from "./process-runner";

/** A workspace's code graph, up to date, and how an agent reaches it. */
interface PreparedGraph {
  readonly server: AgentServer;
  /** Built just now, rather than brought up to date. */
  readonly created: boolean;
  /** Source files in it. */
  readonly files: number;
}

/** Keeps a graph of each workspace's code, for agents to ask about its structure. */
export interface CodeGraph {
  /** Builds the workspace's graph, or brings it up to date with its files. */
  prepare(
    workspace: Workspace,
    signal?: AbortSignal,
  ): Promise<Result<PreparedGraph, ProcessFailure>>;
}

/** Puts the code graph's tool on this machine when it is not, once the user agrees. */
export interface CodeGraphSetup {
  /** The tool, as the user knows it, such as "graf". */
  readonly name: string;
  /** What installing it runs, shown before it does. */
  readonly command: string;
  /** Where to read about it. */
  readonly url: string;
  /** Whether the user said no before; they are not asked again. */
  declined(): boolean;
  /** Remembers that the user said no. */
  decline(): Result<void, FileSystemError>;
  /** Installs the tool, and the code graph it keeps. */
  install(signal?: AbortSignal): Promise<Result<CodeGraph, ProcessFailure>>;
}

/** What an agent learned of a workspace when it studied it, kept for every conversation after. */
export interface ProjectBrief {
  readonly workspaceId: WorkspaceId;
  readonly text: string;
  readonly createdAt: Timestamp;
}

/** Where briefs are kept, one a workspace. */
export interface ProjectBriefs {
  find(workspace: WorkspaceId): Result<ProjectBrief | null, FileSystemError>;
  save(brief: ProjectBrief): Result<void, FileSystemError>;
}

export interface WorkspaceGuidance {
  read(
    root: AbsolutePath,
    name: "AGENTS.md" | "PERSONA.md",
  ): Result<string | null, FileSystemError>;
}
