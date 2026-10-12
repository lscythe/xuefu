import type { AppError } from "../../application/errors";
import type { WorkContext } from "../../domain/work/work-context";
import type { Workspace } from "../../domain/workspace/workspace";
import type { IconSet } from "../theme/status";

/** What a plugin's section is given to draw itself inside its panel. */
export interface SectionProps {
  /** The workspace in front; null when none is open. */
  readonly workspace: Workspace | null;
  /** The work in progress in that workspace; null when there is none. */
  readonly work: WorkContext | null;
  /** Columns and rows inside the panel's frame. */
  readonly width: number;
  readonly rows: number;
  readonly icons: IconSet;
  /**
   * The section has the keyboard, given by Tab or Enter and taken back by Tab or Esc. Meanwhile
   * the arrows, j and k, Enter and digits are the section's; the cockpit's other keys still work.
   */
  readonly focused: boolean;
  /** Sets a word on the section's state into the right of the panel's frame. */
  readonly setStatus: (status: string | null) => void;
  /** Sets the keys that act on the section into the bottom of the panel's frame. */
  readonly setKeys: (keys: string | null) => void;
  /** While a dialog of the section's is open, it has every key, Esc and Ctrl+C included. */
  readonly setModal: (modal: boolean) => void;
  /** Shows a failure above the key bar, as for the cockpit's own actions. */
  readonly report: (error: AppError) => void;
  /**
   * Opens a conversation with the coding agent about something in the section, in the workspace
   * in front. Absent when no agent is installed or no workspace is open.
   */
  readonly askAgent?: ((question: AgentQuestionAbout) => void) | null;
}

/** What a section asks the agent: the first message, and what it is about, for the title. */
export interface AgentQuestionAbout {
  /** A few words, such as "Review MOB/app#42". */
  readonly title: string;
  readonly prompt: string;
}
