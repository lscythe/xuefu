import type { ProcessRunner } from "../../../application/ports/process-runner";
import { ok } from "../../../domain/shared/result";
import type { CheckoutReader } from "../application/checkout";

const TIMEOUT_MS = 5_000;
// Reads only: never takes git's index lock, so it never gets in the way of your own git.
const ENV = { GIT_OPTIONAL_LOCKS: "0" };

/** Reads the branch and origin with the installed git. */
export function gitCheckout(processes: ProcessRunner): CheckoutReader {
  return {
    async read(folder, signal) {
      const run = (args: readonly string[]) =>
        processes.run(
          { command: "git", args, cwd: folder, env: ENV },
          { timeoutMs: TIMEOUT_MS, ...(signal === undefined ? {} : { signal }) },
        );
      const head = await run(["symbolic-ref", "--quiet", "--short", "HEAD"]);
      if (!head.ok) return head;
      // 1 is a detached HEAD; anything else is not a repository.
      if (head.value.exitCode !== 0 && head.value.exitCode !== 1) return ok(null);
      const origin = await run(["remote", "get-url", "origin"]);
      if (!origin.ok) return origin;
      return ok({
        branch: head.value.exitCode === 0 ? head.value.stdout.trim() : null,
        origin: origin.value.exitCode === 0 ? origin.value.stdout.trim() : null,
      });
    },
  };
}
