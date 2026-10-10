import type { AppError } from "../../application/errors";
import type { Workspace } from "../../domain/workspace/workspace";
import type { IconSet } from "../theme/status";

/** What a plugin's section is given to draw itself inside its panel. */
export interface SectionProps {
  /** The workspace in front; null when none is open. */
  readonly workspace: Workspace | null;
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
}
