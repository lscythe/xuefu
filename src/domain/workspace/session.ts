import type { Brand } from "../shared/brand";
import { type ValidationError, validationError } from "../shared/errors";
import { err, ok, type Result } from "../shared/result";

/**
 * Where a workspace was left in the cockpit, e.g. "pulls". Opaque to the domain: the presentation
 * layer owns the vocabulary and falls back to its default for keys it no longer knows.
 */
export type NavigationKey = Brand<string, "NavigationKey">;

const NAVIGATION_KEY = /^[a-z][a-z0-9-]{0,31}$/;

export function navigationKey(raw: string): Result<NavigationKey, ValidationError> {
  if (!NAVIGATION_KEY.test(raw)) {
    return err(
      validationError("Navigation key is invalid", [
        {
          path: "navigation",
          message: "must be 1 to 32 of a-z, 0-9 and '-', starting with a letter",
        },
      ]),
    );
  }
  return ok(raw as NavigationKey);
}
