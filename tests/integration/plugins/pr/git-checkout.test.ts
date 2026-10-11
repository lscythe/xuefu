import { afterEach, describe, expect, test } from "bun:test";
import { realpathSync } from "node:fs";
import type { AbsolutePath } from "../../../../src/domain/shared/path";
import { ok } from "../../../../src/domain/shared/result";
import { BunProcessRunner } from "../../../../src/infrastructure/process/bun-process-runner";
import { gitCheckout } from "../../../../src/plugins/pr/integrations/git-checkout";
import { GIT_ENV, makeRepo } from "../../../support/git-repo";
import { makeTempDir } from "../../../support/temp-dir";

const checkouts = gitCheckout(new BunProcessRunner(GIT_ENV));
const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

describe("gitCheckout", () => {
  test("the branch checked out and where origin fetches from", async () => {
    const repo = makeRepo();
    cleanups.push(repo.cleanup);
    repo.git("remote", "add", "origin", "ssh://git@bitbucket.example.com:7999/mob/app.git");
    repo.git("switch", "-q", "-c", "feature/MOB-2841");
    expect(await checkouts.read(repo.path)).toEqual(
      ok({
        branch: "feature/MOB-2841",
        origin: "ssh://git@bitbucket.example.com:7999/mob/app.git",
      }),
    );
  });

  test("no origin, or a detached HEAD, are said as null", async () => {
    const repo = makeRepo();
    cleanups.push(repo.cleanup);
    expect(await checkouts.read(repo.path)).toEqual(ok({ branch: "main", origin: null }));
    repo.git("switch", "-q", "--detach");
    expect(await checkouts.read(repo.path)).toEqual(ok({ branch: null, origin: null }));
  });

  test("a folder that is not a repository is null", async () => {
    const dir = makeTempDir("xuefu-plain-");
    cleanups.push(dir.cleanup);
    expect(await checkouts.read(realpathSync(dir.path) as AbsolutePath)).toEqual(ok(null));
  });
});
