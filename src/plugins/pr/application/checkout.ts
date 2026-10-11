import type { ProcessFailure } from "../../../application/ports/process-runner";
import type { AbsolutePath } from "../../../domain/shared/path";
import type { Result } from "../../../domain/shared/result";

/** What a workspace has checked out, as far as finding its pull request goes. */
export interface Checkout {
  /** The branch checked out; null when HEAD is detached. */
  readonly branch: string | null;
  /** Where the origin remote fetches from; null when there is no origin. */
  readonly origin: string | null;
}

/** Reads a folder's checkout; null when it is not a git repository. */
export interface CheckoutReader {
  read(
    folder: AbsolutePath,
    signal?: AbortSignal,
  ): Promise<Result<Checkout | null, ProcessFailure>>;
}
