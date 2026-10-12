import { type Accessor, createSignal, Show } from "solid-js";
import { confirmationTokenFor } from "../application/commands/command";
import type { DispatchOptions } from "../application/commands/command-bus";
import type { AppError } from "../application/errors";
import type { ConfirmationPrompt } from "../domain/shared/confirmation";
import type { Result } from "../domain/shared/result";
import { ConfirmDialog } from "./confirm-dialog";
import type { IconSet } from "./theme/status";

/** A confirmation on screen, and how to answer it. */
interface Asking {
  readonly prompt: ConfirmationPrompt;
  readonly answer: (approved: boolean) => void;
}

/**
 * Asking first, for a section's commands that change things. `confirmed` runs a command, and when
 * it asks first, shows its prompt and runs it again approved; it resolves to null when declined.
 * `AskingDialog` draws the prompt while one is waiting, and `asking` says whether one is.
 */
export function createAsking() {
  const [asking, setAsking] = createSignal<Asking | null>(null);

  const ask = (prompt: ConfirmationPrompt) =>
    new Promise<boolean>((resolve) =>
      setAsking({
        prompt,
        answer: (approved) => {
          setAsking(null);
          resolve(approved);
        },
      }),
    );

  const confirmed = async <Output,>(
    invoke: (options?: DispatchOptions) => Promise<Result<Output, AppError>>,
  ): Promise<Result<Output, AppError> | null> => {
    const asked = await invoke();
    if (asked.ok || asked.error.kind !== "confirmation-required") return asked;
    return (await ask(asked.error.prompt))
      ? invoke({ confirmation: confirmationTokenFor(asked.error) })
      : null;
  };

  const AskingDialog = (props: { readonly icons: IconSet }) => (
    <Show when={asking()}>
      {(shown: Accessor<Asking>) => (
        <ConfirmDialog prompt={shown().prompt} icons={props.icons} onAnswer={shown().answer} />
      )}
    </Show>
  );

  return { asking: () => asking() !== null, confirmed, AskingDialog };
}
