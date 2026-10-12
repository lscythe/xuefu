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
import type {
  Mergeability,
  PullRequestClient,
} from "../../../../src/plugins/pr/application/pull-request-client";
import { buildsText, prCommands, reviewsText } from "../../../../src/plugins/pr/cli/commands";
import { diffStat } from "../../../../src/plugins/pr/cli/diff-stat";
import {
  fakePullRequests,
  prChanges,
  pullRequest,
  sampleDiff,
} from "../../../support/fake-pull-requests";

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
    prChanges(client, checkouts),
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

describe("xuefu pr approve, needs-work and unapprove", () => {
  /** A server that records each review it is sent. */
  const reviewing = () => {
    const sent: unknown[][] = [];
    const client = fakePullRequests({ toReview: [pullRequest(42)] }, undefined, {
      review: (repository, id, status, commit) => {
        sent.push([repository, id, status, commit]);
        return Promise.resolve(ok(undefined));
      },
    });
    return { client, sent };
  };

  test("without --yes, asks first: nothing is sent, and the prompt says what would happen", async () => {
    const { client, sent } = reviewing();
    const asked = await run(client, "approve", ["MOB/mobile-banking#42"]);
    expect(sent).toEqual([]);
    const error = asked.code.ok ? null : asked.code.error;
    expect(error?.kind).toBe("confirmation-required");
    expect(error?.kind === "confirmation-required" ? error.prompt : null).toEqual({
      title: "Approve MOB/mobile-banking#42",
      severity: "confirm",
      details: [
        { label: "Pull request", value: "MOB/mobile-banking#42" },
        { label: "Title", value: "Change 42" },
        { label: "Commit", value: "c0ffee42" },
      ],
      consequence: "Approves it on Bitbucket, where its author and reviewers will see it.",
      confirmLabel: "Approve",
    });
  });

  test.each([
    ["approve", "approved", "✓ Approved MOB/mobile-banking#42 (Change 42)\n"],
    ["needs-work", "needs-work", "✓ Asked for changes on MOB/mobile-banking#42 (Change 42)\n"],
    ["unapprove", "unapproved", "✓ Withdrew your review of MOB/mobile-banking#42 (Change 42)\n"],
  ])("%s --yes sends it, of the commit that was read", async (name, status, said) => {
    const { client, sent } = reviewing();
    const done = await run(client, name, ["MOB/mobile-banking#42"], { yes: true });
    expect(done.code).toEqual(ok(0));
    expect(sent).toEqual([[{ project: "MOB", slug: "mobile-banking" }, 42, status, "c0ffee42"]]);
    expect(done.stdout).toBe(said);
  });

  test("without a ref, this branch's; with none, says why and sends nothing", async () => {
    const { client, sent } = reviewing();
    expect((await run(client, "approve", [], { yes: true })).code).toEqual(ok(0));
    expect(sent.map(([, id]) => id)).toEqual([42]);
    const none = await run(
      client,
      "approve",
      [],
      { yes: true },
      {
        checkout: { ...ON_BITBUCKET, branch: "spike" },
      },
    );
    expect(none.code).toEqual(ok(1));
    expect(none.stderr).toBe("No open pull request from spike in MOB/mobile-banking.\n");
    expect(sent).toHaveLength(1);
  });

  test("a review the server refuses is the failure", async () => {
    const refused = remoteError(
      "Bitbucket answered 409: You cannot approve your own pull request",
      "bitbucket.example.com",
      409,
    );
    const shown = await run(
      fakePullRequests({ yours: [pullRequest(42)] }, undefined, {
        review: () => Promise.resolve(err(refused)),
      }),
      "approve",
      ["MOB/mobile-banking#42"],
      { yes: true },
    );
    expect(shown.code).toEqual(err(refused));
    expect(shown.stdout).toBe("");
  });
});

describe("xuefu pr merge", () => {
  const PULL = pullRequest(42, { version: 7, from: "feature/MOB-2841", title: "Add login" });
  /** A server that records each merge it is sent, answering mergeability as `can`. */
  const merging = (can: Partial<Mergeability> = {}, pull = PULL) => {
    const sent: unknown[][] = [];
    const base = fakePullRequests({ yours: [pull] });
    const client: PullRequestClient = {
      ...base,
      mergeability: () =>
        Promise.resolve(ok({ canMerge: true, conflicted: false, vetoes: [], ...can })),
      merge: (repository, id, version) => {
        sent.push([id, version]);
        return base.merge(repository, id, version);
      },
    };
    return { client, sent };
  };

  test("--yes merges it, of the version that was read", async () => {
    const { client, sent } = merging();
    const done = await run(client, "merge", ["MOB/mobile-banking#42"], { yes: true });
    expect(done.code).toEqual(ok(0));
    expect(sent).toEqual([[42, 7]]);
    expect(done.stdout).toBe("✓ Merged MOB/mobile-banking#42 (Add login) into main\n");
  });

  test("without --yes, asks first, naming the branches", async () => {
    const { client, sent } = merging();
    const asked = await run(client, "merge", ["MOB/mobile-banking#42"]);
    const error = asked.code.ok ? null : asked.code.error;
    expect(error?.kind === "confirmation-required" ? error.prompt : null).toMatchObject({
      title: "Merge MOB/mobile-banking#42",
      details: [
        { label: "Pull request", value: "MOB/mobile-banking#42" },
        { label: "Title", value: "Add login" },
        { label: "Branches", value: "feature/MOB-2841 → main" },
      ],
      consequence:
        "Merges feature/MOB-2841 into main on Bitbucket, for everyone; it is not undone by XueFu.",
    });
    expect(sent).toEqual([]);
  });

  test("one Bitbucket will not merge yet says why, before asking anything", async () => {
    const { client, sent } = merging({
      canMerge: false,
      conflicted: true,
      vetoes: ["Requires 2 approvals", "Not all required builds are successful yet"],
    });
    const refused = await run(client, "merge", ["MOB/mobile-banking#42"], { yes: true });
    expect(refused.code.ok ? null : refused.code.error).toMatchObject({
      kind: "conflict",
      message: "MOB/mobile-banking#42 cannot be merged yet",
      hint: "it conflicts with main; merge main into feature/MOB-2841 first; Requires 2 approvals; Not all required builds are successful yet.",
    });
    expect(sent).toEqual([]);
    const silent = await run(merging({ canMerge: false }).client, "merge", [
      "MOB/mobile-banking#42",
    ]);
    expect(silent.code.ok ? null : silent.code.error.hint).toBe("Bitbucket did not say why.");
  });

  test("one already merged or declined is not offered", async () => {
    const { client, sent } = merging({}, { ...PULL, state: "merged" });
    const done = await run(client, "merge", ["MOB/mobile-banking#42"], { yes: true });
    expect(done.code.ok ? null : done.code.error.message).toBe("MOB/mobile-banking#42 is merged");
    expect(sent).toEqual([]);
  });
});

describe("xuefu pr diff", () => {
  test("the unified diff as Bitbucket sends it, for piping to a pager", async () => {
    const shown = await run(fakePullRequests({ yours: [pullRequest(42)] }), "diff", [
      "MOB/mobile-banking#42",
    ]);
    expect(shown.code).toEqual(ok(0));
    expect(shown.stdout).toBe(sampleDiff({ id: 42 }));
  });

  test("--stat lists the files, how each changed, and the totals", async () => {
    const shown = await run(fakePullRequests({ yours: [pullRequest(42)] }), "diff", [], {
      stat: true,
    });
    expect(shown.stdout).toBe(
      [
        "M  app/src/Login.kt  +2 -1",
        "A  docs/login.md     +2",
        "2 files changed, 4 lines added, 1 line removed",
        "",
      ].join("\n"),
    );
  });

  test("a rename, a binary file, and nothing at all", () => {
    expect(
      diffStat([
        {
          from: "src/A.kt",
          to: "src/B.kt",
          change: "renamed",
          binary: false,
          hunks: [],
          added: 0,
          removed: 0,
        },
        {
          from: "logo.png",
          to: "logo.png",
          change: "modified",
          binary: true,
          hunks: [],
          added: 0,
          removed: 0,
        },
      ]),
    ).toBe(
      [
        "R  src/A.kt → src/B.kt",
        "M  logo.png             binary",
        "2 files changed, 0 lines added, 0 lines removed",
        "",
      ].join("\n"),
    );
    expect(diffStat([])).toBe("No changes.\n");
  });
});

describe("summaries", () => {
  test("reviews and builds in a few words", () => {
    expect(reviewsText({ reviewers: [] })).toBe("no reviewers");
    expect(buildsText({ successful: 0, failed: 0, inProgress: 2 })).toBe("2 running");
    expect(buildsText({ successful: 0, failed: 0, inProgress: 0 })).toBe("none");
  });
});
