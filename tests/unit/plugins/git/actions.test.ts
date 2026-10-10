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
