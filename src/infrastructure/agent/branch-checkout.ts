import type { BranchCheckout, PutBack } from "../../application/ports/agent";
import type { ProcessRunner } from "../../application/ports/process-runner";
import { processError } from "../../domain/shared/errors";
import { err, ok } from "../../domain/shared/result";

/** Switching, stashing and reading refs, on a large repository and a slow disk. */
const LOCAL_TIMEOUT_MS = 60_000;
/** Fetching a branch over a slow link. */
const NETWORK_TIMEOUT_MS = 2 * 60_000;

const ENV = {
  // Never wait on a password, a passphrase or an editor nobody can see: the cockpit is drawing.
  GIT_TERMINAL_PROMPT: "0",
  GIT_EDITOR: "true",
  SSH_ASKPASS_REQUIRE: "force",
  SSH_ASKPASS: "false",
  LC_ALL: "C",
};

/** How a git command went: its output, or why it failed in a line. */
type Ran =
  | { readonly ok: true; readonly out: string }
  | { readonly ok: false; readonly why: string };

/** Why git failed: its first fatal or error line, or else the last thing it said. */
function reason(stderr: string, stdout: string): string {
  const lines = (stderr.trim() === "" ? stdout : stderr)
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
  const fatal = lines.find((line) => /^(fatal|error): /.test(line));
  return (fatal ?? lines.at(-1) ?? "it failed").replace(/^(fatal|error): /, "");
}

const failed = (text: string): PutBack => err(processError(text, "git", null));

/**
 * Checks out a pull request's branch for a review with the installed git, and puts the clone
 * back afterwards. Uncommitted changes, untracked files included, are stashed under a message
 * naming the branch, and found again by their commit, so stashes made meanwhile are left alone.
 * A local branch of the same name is brought up to date when it can be fast-forwarded, and
 * reviewed as it is when it has commits of its own; otherwise one tracking origin's is made.
 */
export function gitCheckout(processes: ProcessRunner): BranchCheckout {
  return {
    async checkout(folder, branch, say, signal) {
      const git = async (args: readonly string[], network = false): Promise<Ran> => {
        const ran = await processes.run(
          { command: "git", args, cwd: folder, env: ENV },
          network ? { timeoutMs: NETWORK_TIMEOUT_MS, signal } : { timeoutMs: LOCAL_TIMEOUT_MS },
        );
        if (!ran.ok) return { ok: false, why: ran.error.message };
        const { exitCode, stdout, stderr } = ran.value;
        return exitCode === 0
          ? { ok: true, out: stdout.trim() }
          : { ok: false, why: reason(stderr, stdout) };
      };

      const onBranch = await git(["symbolic-ref", "--quiet", "--short", "HEAD"]);
      const head = await git(["rev-parse", "HEAD"]);
      if (!head.ok) {
        say(`Could not read what is checked out: ${head.why}`, true);
        return null;
      }
      const remote = `refs/remotes/origin/${branch}`;
      const fetched = await git(
        ["fetch", "--no-tags", "origin", `+refs/heads/${branch}:${remote}`],
        true,
      );
      if (!fetched.ok) {
        say(`Could not fetch ${branch}, so what is checked out is reviewed: ${fetched.why}`, true);
        return null;
      }
      const tip = await git(["rev-parse", "--short", remote]);
      const at = tip.ok ? ` at ${tip.out}` : "";

      /** Brings the local branch up to origin's, when it has no commits of its own. */
      const forward = async () => {
        const merged = await git(["merge", "--ff-only", "--quiet", remote]);
        if (!merged.ok) {
          say(
            `Your ${branch} could not be brought up to origin's; it is reviewed as it is: ${merged.why}`,
            true,
          );
        }
      };

      if (onBranch.ok && onBranch.out === branch) {
        await forward();
        say(`${branch} was already checked out; it is reviewed${at}.`, false);
        return null;
      }

      const changes = await git(["status", "--porcelain", "--untracked-files=normal"]);
      if (!changes.ok) {
        say(`Could not see whether you have uncommitted changes: ${changes.why}`, true);
        return null;
      }
      const message = `xuefu: before reviewing ${branch}`;
      let stash: string | null = null;
      if (changes.out !== "") {
        const stashed = await git(["stash", "push", "--include-untracked", "--message", message]);
        const made = stashed.ok ? await git(["rev-parse", "refs/stash"]) : stashed;
        if (!made.ok) {
          say(
            `Could not stash your uncommitted changes, so nothing was checked out: ${made.why}`,
            true,
          );
          return null;
        }
        stash = made.out;
        say(`Stashed your uncommitted changes as "${message}".`, false);
      }

      const local = await git(["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`]);
      const switched = local.ok
        ? await git(["switch", branch])
        : await git(["switch", "--create", branch, "--track", remote]);
      if (!switched.ok) {
        say(`Could not check out ${branch}: ${switched.why}`, true);
        if (stash !== null) {
          const popped = await git(["stash", "pop", "--index", "--quiet"]);
          say(
            popped.ok
              ? "Your uncommitted changes are back as they were."
              : `Your uncommitted changes are still stashed: ${popped.why}`,
            !popped.ok,
          );
        }
        return null;
      }
      if (local.ok) await forward();
      say(`Checked out ${branch}${at}.`, false);

      const back = onBranch.ok ? onBranch.out : head.out.slice(0, 12);
      return async (): Promise<PutBack> => {
        const after = await git(["status", "--porcelain", "--untracked-files=normal"]);
        const kept = stash === null ? "" : ` Your uncommitted changes are stashed as "${message}".`;
        if (!after.ok || after.out !== "") {
          return failed(
            `${branch} was left checked out, as it has changes made during the review.${kept}`,
          );
        }
        const returned = onBranch.ok
          ? await git(["switch", onBranch.out])
          : await git(["switch", "--detach", head.out]);
        if (!returned.ok) {
          return failed(`Could not check out ${back} again: ${returned.why}.${kept}`);
        }
        if (stash === null) return ok(`Back on ${back}.`);
        const listed = await git(["stash", "list", "--format=%H"]);
        const index = listed.ok ? listed.out.split("\n").indexOf(stash) : -1;
        if (index === -1) {
          return failed(`Back on ${back}, but the stash of your uncommitted changes is gone.`);
        }
        const popped = await git(["stash", "pop", "--index", "--quiet", `stash@{${index}}`]);
        return popped.ok
          ? ok(`Back on ${back}, with your uncommitted changes.`)
          : failed(
              `Back on ${back}, but your uncommitted changes could not be put back: ${popped.why}.${kept}`,
            );
      };
    },
  };
}
