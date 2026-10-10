import type { ConfigurationError, ProcessError } from "../../domain/shared/errors";
import type { Result } from "../../domain/shared/result";
import type { Secret, SecretRef } from "../../domain/shared/secret";
import type { ProcessFailure } from "./process-runner";

/** Not there to be found is a configuration problem; a keychain that would not answer is not. */
export type SecretFailure = ConfigurationError | ProcessFailure | ProcessError;

/** Looks credentials up where config says they are kept, masking each wherever XueFu writes. */
export interface SecretProvider {
  resolve(ref: SecretRef, signal?: AbortSignal): Promise<Result<Secret, SecretFailure>>;
}
