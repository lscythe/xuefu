import type { CoreError } from "../domain/shared/errors";

/** Every error a command can return. Integration error unions join here as they are added. */
export type AppError = CoreError;
