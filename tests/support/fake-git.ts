import { ok } from "../../src/domain/shared/result";
import type { GitClient } from "../../src/plugins/git/application/git-client";

/** A git client where nothing is a repository and every change succeeds, unless overridden. */
export function fakeGit(overrides: Partial<GitClient> = {}): GitClient {
  return {
    status: () => Promise.resolve(ok(null)),
    stage: () => Promise.resolve(ok(undefined)),
    unstage: () => Promise.resolve(ok(undefined)),
    branches: () => Promise.resolve(ok([])),
    createBranch: () => Promise.resolve(ok(undefined)),
    switchBranch: () => Promise.resolve(ok(undefined)),
    deleteBranch: () => Promise.resolve(ok(true)),
    remotes: () => Promise.resolve(ok(["origin"])),
    fetch: () => Promise.resolve(ok(undefined)),
    pull: () => Promise.resolve(ok(undefined)),
    push: () => Promise.resolve(ok(undefined)),
    commit: () => Promise.resolve(ok("9f8e7d6c5b4a39281706f5e4d3c2b1a098765432")),
    ...overrides,
  };
}
