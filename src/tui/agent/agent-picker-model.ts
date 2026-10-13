import type { AppError } from "../../application/errors";
import type { AgentChoice, AgentModel } from "../../application/ports/agent";
import { rankFuzzy } from "../../application/search/fuzzy";
import type { Result } from "../../domain/shared/result";

/** An agent installed and the models it can run, as far as they are known yet. */
export interface AgentModels {
  readonly id: string;
  readonly name: string;
  /** Null while they are being found out. */
  readonly models: Result<readonly AgentModel[], AppError> | null;
}

export type PickerRow =
  | { readonly kind: "agent"; readonly name: string }
  | { readonly kind: "note"; readonly text: string; readonly failed: boolean }
  | {
      readonly kind: "model";
      readonly choice: AgentChoice;
      readonly name: string;
      /** Matched code-point positions in the name, for highlighting. */
      readonly hits: readonly number[];
    };

/**
 * Rows to show for a query: each agent under its name, with its models in the order it gives
 * them, the ones matching the query best first, and a line for models still being found out or
 * that could not be. An agent with nothing matching is left out.
 */
export function pickerRows(agents: readonly AgentModels[], query: string): PickerRow[] {
  const trimmed = query.trim();
  return agents.flatMap((agent): PickerRow[] => {
    const heading: PickerRow = { kind: "agent", name: agent.name };
    if (agent.models === null) {
      return [heading, { kind: "note", text: "Finding its models…", failed: false }];
    }
    if (!agent.models.ok) {
      return [heading, { kind: "note", text: agent.models.error.message, failed: true }];
    }
    const ranked = rankFuzzy(agent.models.value, trimmed, (model) => [model.name, model.id ?? ""]);
    if (ranked.length === 0) return [];
    return [
      heading,
      ...ranked.map(({ item, match, key }) => ({
        kind: "model" as const,
        choice: { agent: agent.id, model: item.id },
        name: item.name,
        hits: key === 0 ? match.positions : [],
      })),
    ];
  });
}

export const sameChoice = (a: AgentChoice, b: AgentChoice) =>
  a.agent === b.agent && a.model === b.model;
