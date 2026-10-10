import { describe, expect, test } from "bun:test";
import { confirmationTokenFor } from "../../../../src/application/commands/command";
import { CommandBus } from "../../../../src/application/commands/command-bus";
import type { AbsolutePath } from "../../../../src/domain/shared/path";
import { ok } from "../../../../src/domain/shared/result";
import { gitActions } from "../../../../src/plugins/git/application/actions";
import type { GitFiles } from "../../../../src/plugins/git/application/git-client";
import { fakeGit } from "../../../support/fake-git";
import { ManualClock } from "../../../support/manual-clock";
import { SequentialIds } from "../../../support/sequential-ids";
import { testLogger } from "../../../support/test-logger";

const FOLDER = "/work/mobile";

function setup() {
  const calls: { op: string; folder: AbsolutePath; arg: GitFiles | string }[] = [];
  const client = fakeGit({
    stage: (folder, files) => {
      calls.push({ op: "stage", folder, arg: files });
      return Promise.resolve(ok(undefined));
    },
    unstage: (folder, files) => {
      calls.push({ op: "unstage", folder, arg: files });
      return Promise.resolve(ok(undefined));
    },
    commit: (folder, message) => {
      calls.push({ op: "commit", folder, arg: message });
      return Promise.resolve(ok("1a2b3c4d"));
    },
  });
  const bus = new CommandBus({
    logger: testLogger().logger,
    clock: new ManualClock(),
    ids: new SequentialIds(),
  });
  const actions = gitActions(client);
  bus.register(actions.stage);
  bus.register(actions.unstage);
  bus.register(actions.commit);
  return { bus, actions, calls };
}

describe("gitActions", () => {
  test("stage and unstage pass the files on, or all of them", async () => {
    const { bus, actions, calls } = setup();
    expect(await bus.invoke(actions.stage, { folder: FOLDER, files: ["a.ts"] })).toEqual(
      ok(undefined),
    );
    await bus.invoke(actions.unstage, { folder: FOLDER, files: "all" });
    expect(calls).toEqual([
      { op: "stage", folder: FOLDER as AbsolutePath, arg: ["a.ts"] },
      { op: "unstage", folder: FOLDER as AbsolutePath, arg: "all" },
    ]);
  });

  test("commit gives the new commit with its subject", async () => {
    const { bus, actions, calls } = setup();
    const made = await bus.invoke(actions.commit, {
      folder: FOLDER,
      message: "\nFix login\n\nDetails\n",
    });
    expect(made).toEqual(ok({ commit: "1a2b3c4d", subject: "Fix login" }));
    expect(calls[0]?.arg).toBe("Fix login\n\nDetails");
  });

  test.each([
    ["git.stage", { folder: "work/mobile", files: ["a.ts"] }, "folder"],
    ["git.stage", { folder: FOLDER, files: [] }, "files"],
    ["git.unstage", { folder: FOLDER, files: ["../outside"] }, "files"],
    ["git.commit", { folder: FOLDER, message: "  " }, "message"],
  ])("%s refuses %j", async (name, input, path) => {
    const { bus, calls } = setup();
    const refused = await bus.dispatch(name, input);
    expect(refused.ok ? null : refused.error.kind).toBe("validation");
    if (!refused.ok && refused.error.kind === "validation") {
      expect(refused.error.issues.map((issue) => issue.path)).toContain(path);
    }
    expect(calls).toEqual([]);
  });
});

describe("gitActions branches", () => {
  function setupDelete() {
    const deletes: { name: string; force: boolean }[] = [];
    const bus = new CommandBus({
      logger: testLogger().logger,
      clock: new ManualClock(),
      ids: new SequentialIds(),
    });
    const actions = gitActions(
      fakeGit({
        deleteBranch: (_folder, name, force) => {
          deletes.push({ name, force });
          return Promise.resolve(ok(name !== "unmerged"));
        },
      }),
    );
    bus.register(actions.createBranch);
    bus.register(actions.checkout);
    bus.register(actions.deleteBranch);
    return { bus, actions, deletes };
  }

  test("deleting asks first, more gravely when forced, and the answer binds the branch", async () => {
    const { bus, actions, deletes } = setupDelete();
    const asked = await bus.invoke(actions.deleteBranch, {
      folder: FOLDER,
      name: "feat",
      force: false,
    });
    expect(asked.ok ? null : asked.error.kind).toBe("confirmation-required");
    if (asked.ok || asked.error.kind !== "confirmation-required") return;
    expect(asked.error.prompt).toMatchObject({ severity: "confirm", title: "Delete branch" });

    const token = confirmationTokenFor(asked.error);
    const other = await bus.invoke(
      actions.deleteBranch,
      { folder: FOLDER, name: "main", force: false },
      { confirmation: token },
    );
    expect(other.ok ? null : other.error.kind).toBe("confirmation-required");
    expect(
      await bus.invoke(
        actions.deleteBranch,
        { folder: FOLDER, name: "feat", force: false },
        { confirmation: token },
      ),
    ).toEqual(ok({ deleted: true }));
    expect(deletes).toEqual([{ name: "feat", force: false }]);

    const forced = await bus.invoke(actions.deleteBranch, {
      folder: FOLDER,
      name: "feat",
      force: true,
    });
    expect(
      forced.ok ? null : forced.error.kind === "confirmation-required" && forced.error.prompt,
    ).toMatchObject({ severity: "destructive", title: "Force-delete branch" });
  });

  test("a branch git keeps as unmerged is reported as not deleted", async () => {
    const { bus, actions } = setupDelete();
    const input = { folder: FOLDER, name: "unmerged", force: false };
    const asked = await bus.invoke(actions.deleteBranch, input);
    if (asked.ok || asked.error.kind !== "confirmation-required") throw new Error("not asked");
    expect(
      await bus.invoke(actions.deleteBranch, input, {
        confirmation: confirmationTokenFor(asked.error),
      }),
    ).toEqual(ok({ deleted: false }));
  });

  test.each([
    ["git.branch.create", { folder: FOLDER, name: "has space", start: null }],
    ["git.branch.create", { folder: FOLDER, name: "ok", start: "-x" }],
    ["git.branch.checkout", { folder: FOLDER, name: "a..b", track: false }],
  ])("%s refuses %j", async (command, input) => {
    const { bus } = setupDelete();
    const refused = await bus.dispatch(command, input);
    expect(refused.ok ? null : refused.error.kind).toBe("validation");
  });
});

describe("gitActions fetch, pull and push", () => {
  function remoteSetup(branch: string | null = "main") {
    const calls: string[] = [];
    const bus = new CommandBus({
      logger: testLogger().logger,
      clock: new ManualClock(),
      ids: new SequentialIds(),
    });
    const actions = gitActions(
      fakeGit({
        status: () =>
          Promise.resolve(
            ok({
              branch,
              commit: "1a2b3c4",
              upstream: null,
              ahead: 0,
              behind: 0,
              changes: [],
              conflicts: [],
              untracked: [],
              stashes: 0,
            }),
          ),
        fetch: () => {
          calls.push("fetch");
          return Promise.resolve(ok(undefined));
        },
        pull: () => {
          calls.push("pull");
          return Promise.resolve(ok(undefined));
        },
        push: (_folder, publish) => {
          calls.push(publish === null ? "push" : `publish ${publish.remote} ${publish.branch}`);
          return Promise.resolve(ok(undefined));
        },
      }),
    );
    bus.register(actions.fetch);
    bus.register(actions.pull);
    bus.register(actions.push);
    /** Asks, approves what was asked, and gives the prompt with the outcome. */
    const approve = async (command: typeof actions.push | typeof actions.pull, input: object) => {
      const asked = await bus.invoke(command as typeof actions.push, input);
      if (asked.ok || asked.error.kind !== "confirmation-required") throw new Error("not asked");
      const done = await bus.invoke(command as typeof actions.push, input, {
        confirmation: confirmationTokenFor(asked.error),
      });
      return { prompt: asked.error.prompt, done };
    };
    return { bus, actions, calls, approve };
  }

  test("fetching runs at once", async () => {
    const { bus, actions, calls } = remoteSetup();
    expect(await bus.invoke(actions.fetch, { folder: FOLDER })).toEqual(ok(undefined));
    expect(calls).toEqual(["fetch"]);
  });

  test("pushing asks first, naming the branch, where it goes and how much", async () => {
    const { actions, calls, approve } = remoteSetup();
    const { prompt, done } = await approve(actions.push, {
      folder: FOLDER,
      branch: "main",
      remote: "origin",
      upstream: "origin/main",
      ahead: 2,
    });
    expect(prompt).toMatchObject({
      title: "Push",
      details: [
        { label: "Branch", value: "main" },
        { label: "To", value: "origin/main" },
        { label: "Repository", value: FOLDER },
      ],
      consequence: "Sends 2 commits to origin/main, where others will see them.",
    });
    expect(done).toEqual(ok(undefined));
    expect(calls).toEqual(["push"]);
  });

  test("a branch with no upstream is published on the remote", async () => {
    const { actions, calls, approve } = remoteSetup("feat/x");
    const { prompt } = await approve(actions.push, {
      folder: FOLDER,
      branch: "feat/x",
      remote: "origin",
      upstream: null,
      ahead: 0,
    });
    expect(prompt).toMatchObject({
      title: "Publish branch",
      consequence: "Makes feat/x on origin with its commits, and tracks it from now on.",
      confirmLabel: "Publish",
    });
    expect(calls).toEqual(["publish origin feat/x"]);
  });

  test("pulling asks first, saying how many commits come in", async () => {
    const { actions, calls, approve } = remoteSetup();
    const { prompt } = await approve(actions.pull, {
      folder: FOLDER,
      branch: "main",
      upstream: "origin/main",
      behind: 1,
    });
    expect(prompt.consequence).toBe(
      "Brings 1 commit from origin/main into main, merging or rebasing as your git config says.",
    );
    expect(calls).toEqual(["pull"]);
  });

  test("what was approved for one branch is not done once another is in front", async () => {
    const { actions, calls, approve } = remoteSetup("other");
    const { done } = await approve(actions.pull, {
      folder: FOLDER,
      branch: "main",
      upstream: "origin/main",
      behind: 0,
    });
    expect(done.ok ? null : done.error.message).toBe("The branch is now other, not main");
    expect(calls).toEqual([]);
  });

  test("a remote named like an option is refused", async () => {
    const { bus } = remoteSetup();
    const refused = await bus.dispatch("git.push", {
      folder: FOLDER,
      branch: "main",
      remote: "--force",
      upstream: null,
      ahead: 0,
    });
    expect(refused.ok ? null : refused.error.kind).toBe("validation");
  });
});
