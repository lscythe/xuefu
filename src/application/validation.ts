import { z } from "zod";
import type { ValidationError } from "../domain/shared/errors";
import type { Result } from "../domain/shared/result";

/**
 * A string schema that runs a domain smart constructor, so command input is validated by the same
 * rules as the domain and issues are reported against the input field that failed.
 */
export function domainString<T>(parse: (raw: string) => Result<T, ValidationError>) {
  return z.string().transform((raw, ctx): T => {
    const parsed = parse(raw);
    if (parsed.ok) return parsed.value;
    for (const issue of parsed.error.issues) {
      ctx.addIssue({ code: "custom", message: issue.message });
    }
    return z.NEVER;
  });
}
