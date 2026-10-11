import { describe, expect, test } from "bun:test";
import type { AppError } from "../../../../src/application/errors";
import type { PluginInvocation } from "../../../../src/cli/plugin-command";
import { notFound, remoteError } from "../../../../src/domain/shared/errors";
import type { WorkspaceId } from "../../../../src/domain/shared/ids";
import type { AbsolutePath } from "../../../../src/domain/shared/path";
import { err, ok, type Result } from "../../../../src/domain/shared/result";
import type { Timestamp } from "../../../../src/domain/shared/time";
import type { Workspace, WorkspaceName } from "../../../../src/domain/workspace/workspace";
import type { Checkout, CheckoutReader } from "../../../../src/plugins/pr/application/checkout";
import type { PullRequestClient } from "../../../../src/plugins/pr/application/pull-request-client";
import { buildsText, prCommands, reviewsText } from "../../../../src/plugins/pr/cli/commands";
import { fakePullRequests, pullRequest } from "../../../support/fake-pull-requests";

const MOBILE: Workspace = {
  id: "mobile" as WorkspaceId,
  name: "Mobile" as WorkspaceName,
  path: "/work/mobile" as AbsolutePath,
  group: null,
  addedAt: 0 as Timestamp,
  lastActiveAt: null,
};

const ON_BITBUCKET: Checkout = {
  branch: "feature/change-42",
  origin: "ssh://git@bitbucket.example.com:7999/mob/mobile-banking.git",
};

async function run(
  client: PullRequestClient,
  name: string,
  args: string[] = [],
  flags: PluginInvocation["flags"] = {},
  options: { max?: number; checkout?: Checkout | null } = {},
) {
  let stdout = "";
  let stderr = "";
  const read: string[] = [];
  const checkouts: CheckoutReader = {
    read: (folder) => {
      read.push(folder);
      return Promise.resolve(ok(options.checkout === undefined ? ON_BITBUCKET : options.checkout));
    },
  };
  const code: Result<number, AppError> = await prCommands(
    { client, checkouts, host: "bitbucket.example.com" },
    options.max ?? 25,
  )(
    { group: "pr", name, args, flags },
    {
      workspace: (id) =>
        Promise.resolve(
          id === null || id === "mobile" ? ok(MOBILE) : err(notFound("workspace", id)),
        ),
      stdout: (text) => {
        stdout += text;
      },
      stderr: (text) => {
        stderr += text;
      },
    },
  );
  return { code, stdout, stderr, read };
}

describe("xuefu pr list", () => {
  test("yours, then those to review, in one table", async () => {
    const shown = await run(
      fakePullRequests({
        yours: [pullRequest(42, { title: "Add biometric login" })],
        toReview: [
          pullRequest(40, {
            title: "Fix rotate crash",
            reviewers: [{ name: "Dana Scully", status: "needs-work" }],
          }),
        ],
      }),
      "list",
    );
    expect(shown.code).toEqual(ok(0));
    const lines = shown.stdout.trimEnd().split("\n");
    expect(lines[0]).toMatch(/^ {2}PULL REQUEST\s+REVIEWS\s+UPDATED\s+TITLE$/);
    expect(lines[1]).toBe("Yours");
    expect(lines[2]).toMatch(
      /^ {2}MOB\/mobile-banking#42 {2}0\/1 approved {2}.* {2}Add biometric login$/,
    );
    expect(lines[3]).toBe("To review");
    expect(lines[4]).toMatch(
      /^ {2}MOB\/mobile-banking#40 {2}needs work {4}.* {2}Fix rotate crash$/,
    );
    expect(shown.stderr).toBe("");
  });

  test("an empty group is left out, and one cut short says so", async () => {
    const shown = await run(
      fakePullRequests({ toReview: [pullRequest(1), pullRequest(2)] }),
      "list",
      [],
      {},
      { max: 1 },
    );
    expect(shown.stdout).not.toContain("Yours");
    expect(shown.stderr).toBe("To review: more than 1 are open; only 1 are shown.\n");
  });

  test("none at all exits 1; --json gives both lists", async () => {
    const none = await run(fakePullRequests(), "list");
    expect(none.code).toEqual(ok(1));
    expect(none.stderr).toBe("No open pull requests are yours or wait on your review.\n");
    const shown = await run(fakePullRequests({ yours: [pullRequest(42)] }), "list", [], {
      json: true,
    });
    expect(JSON.parse(shown.stdout)).toMatchObject({
      yours: [{ ref: "MOB/mobile-banking#42", updated: "2026-10-06T13:59:00.000Z" }],
      toReview: [],
    });
  });

  test("a failure of either list fails the command", async () => {
    const refused = remoteError("Bitbucket did not accept the token", "bitbucket.example.com", 401);
    const shown = await run(
      fakePullRequests({}, undefined, {
        mine: (role) =>
          Promise.resolve(
            role === "reviewer" ? err(refused) : ok({ pullRequests: [], more: false }),
          ),
      }),
      "list",
    );
    expect(shown.code).toEqual(err(refused));
  });
});

describe("xuefu pr show", () => {
  const PULL = pullRequest(42, {
    title: "Add biometric login",
    from: "feature/MOB-2841",
    reviewers: [
      { name: "Fox Mulder", status: "approved" },
      { name: "Walter Skinner", status: "needs-work" },
      { name: "Monica Reyes", status: "unapproved" },
    ],
    comments: 3,
    openTodos: 1,
    description: "Adds Face ID.",
  });

  test("the details, reviews, builds, address and description", async () => {
    const shown = await run(
      fakePullRequests({ yours: [PULL] }, { successful: 2, failed: 1, inProgress: 0 }),
      "show",
      ["mob/mobile-banking#42"],
    );
    expect(shown.code).toEqual(ok(0));
    expect(shown.stdout.split("\n")[0]).toBe("MOB/mobile-banking#42  Add biometric login");
    for (const line of [
      "  State      Open\n",
      "  Branches   feature/MOB-2841 → main\n",
      "  Reviewers  Fox Mulder (approved), Walter Skinner (needs work), Monica Reyes\n",
      "  Builds     2 passed, 1 failed\n",
      "  Comments   3, 1 to do\n",
      "  Merge      clean\n",
    ]) {
      expect(shown.stdout).toContain(line);
    }
    expect(shown.stdout).toEndWith(
      "  https://bitbucket.example.com/projects/MOB/repos/mobile-banking/pull-requests/42\n\nAdds Face ID.\n",
    );
  });

  test("builds that cannot be read are said, not fatal; --json carries them", async () => {
    const unread = await run(
      fakePullRequests({ yours: [PULL] }, undefined, {
        builds: () =>
          Promise.resolve(err(remoteError("Bitbucket answered 500", "bitbucket.example.com", 500))),
      }),
      "show",
      ["MOB/mobile-banking#42"],
    );
    expect(unread.stdout).toContain("  Builds     could not be read: Bitbucket answered 500\n");
    const json = await run(fakePullRequests({ yours: [PULL] }), "show", ["MOB/mobile-banking#42"], {
      json: true,
    });
    expect(JSON.parse(json.stdout)).toMatchObject({
      ref: "MOB/mobile-banking#42",
      builds: { successful: 1, failed: 0, inProgress: 0 },
    });
  });

  test("without a ref, the pull request from this workspace's branch", async () => {
    const shown = await run(fakePullRequests({ yours: [pullRequest(42)] }), "show");
    expect(shown.code).toEqual(ok(0));
    expect(shown.read).toEqual(["/work/mobile"]);
    expect(shown.stdout.split("\n")[0]).toBe("MOB/mobile-banking#42  Change 42");
    const elsewhere = await run(fakePullRequests({ yours: [pullRequest(42)] }), "show", [], {
      workspace: "nowhere",
    });
    expect(elsewhere.code.ok ? null : elsewhere.code.error.kind).toBe("not-found");
  });

  test("without a ref, says why there is none to show, exiting 1", async () => {
    const why = async (checkout: Checkout | null) => {
      const shown = await run(fakePullRequests(), "show", [], {}, { checkout });
      expect(shown.code).toEqual(ok(1));
      return shown.stderr;
    };
    expect(await why(ON_BITBUCKET)).toBe(
      "No open pull request from feature/change-42 in MOB/mobile-banking.\n",
    );
    expect(await why({ ...ON_BITBUCKET, branch: null })).toBe(
      "HEAD is detached in Mobile; switch to a branch, or name one, as PROJECT/repository#42.\n",
    );
    expect(await why({ ...ON_BITBUCKET, origin: "https://github.com/mob/app.git" })).toBe(
      "Mobile's origin is not on bitbucket.example.com; name one, as PROJECT/repository#42.\n",
    );
    expect(await why({ ...ON_BITBUCKET, origin: null })).toBe(
      "Mobile has no origin remote; name one, as PROJECT/repository#42.\n",
    );
    expect(await why(null)).toBe(
      "Mobile is not a git repository; name one, as PROJECT/repository#42.\n",
    );
  });

  test("not a ref, or not found", async () => {
    const bad = await run(fakePullRequests(), "show", ["42"]);
    expect(bad.code.ok ? null : bad.code.error.kind).toBe("validation");
    const missing = await run(fakePullRequests(), "show", ["MOB/mobile-banking#9"]);
    expect(missing.code.ok ? null : missing.code.error.kind).toBe("not-found");
  });
});

describe("summaries", () => {
  test("reviews and builds in a few words", () => {
    expect(reviewsText({ reviewers: [] })).toBe("no reviewers");
    expect(buildsText({ successful: 0, failed: 0, inProgress: 2 })).toBe("2 running");
    expect(buildsText({ successful: 0, failed: 0, inProgress: 0 })).toBe("none");
  });
});
