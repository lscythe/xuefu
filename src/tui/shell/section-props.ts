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
  /** Sets a word on the section's state into the right of the panel's frame. */
  readonly setStatus: (status: string | null) => void;
}
