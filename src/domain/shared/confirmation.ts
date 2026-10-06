type ConfirmationSeverity = "confirm" | "destructive";

/** Everything a user must see before approving a consequential action. */
export interface ConfirmationPrompt {
  readonly title: string;
  readonly severity: ConfirmationSeverity;
  readonly details: readonly { readonly label: string; readonly value: string }[];
  readonly consequence: string;
  readonly confirmLabel: string;
}
