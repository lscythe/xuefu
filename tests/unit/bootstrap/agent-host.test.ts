import { describe, expect, test } from "bun:test";
import type {
  AgentChoice,
  AgentChoices,
  AgentEvent,
  AgentLaunch,
  AgentRunner,
  AgentServer,
  AgentSession,
  BranchCheckout,
  DraftComment,
  DraftReview,
  PutBack,
} from "../../../src/application/ports/agent";
import type {
  CodeGraph,
  CodeGraphSetup,
  ProjectBrief,
  ProjectBriefs,
  WorkspaceGuidance,
} from "../../../src/application/ports/project-context";
import { agentHost, approvalPrompt } from "../../../src/bootstrap/agent-host";
import { PLUGIN_COMMANDS } from "../../../src/bootstrap/plugins";
import type { McpTools } from "../../../src/cli/mcp-server";
import { type McpTool, mcpTools } from "../../../src/cli/mcp-tools";
import type { ConfirmationPrompt } from "../../../src/domain/shared/confirmation";
import { fileSystemError, processError } from "../../../src/domain/shared/errors";
import type { WorkspaceId } from "../../../src/domain/shared/ids";
import type { AbsolutePath } from "../../../src/domain/shared/path";
import { err, ok } from "../../../src/domain/shared/result";
import type { Timestamp } from "../../../src/domain/shared/time";
import type { Workspace, WorkspaceName } from "../../../src/domain/workspace/workspace";
import { ManualClock } from "../../support/manual-clock";

const DIFF: McpTool = {
  name: "pr_diff",
  description: "Show what a pull request changes, as a unified diff",
  parameters: { pullRequest: { type: "string", description: "the pull request" } },
  changes: false,
  argv: (values) => ["pr", "diff", "--", String(values["pullRequest"])],
};
const APPROVE: McpTool = {
  name: "pr_approve",
  description: "Approve a pull request",
  parameters: {
    pullRequest: { type: "string", description: "the pull request" },
    yes: { type: "boolean", description: "confirm without asking" },
  },
  changes: true,
  argv: (values) => ["pr", "approve", ...(values["yes"] === true ? ["--yes"] : [])],
};

describe("approvalPrompt", () => {
  test("XueFu's tool by its command and what it does, each argument; a flag by its meaning", () => {
    expect(
      approvalPrompt("Claude", [DIFF, APPROVE], "mcp__xuefu__pr_approve", {
        pullRequest: "MOB/app#42",
        yes: true,
      }),
    ).toEqual({
      title: "Let Claude run pr approve",
      severity: "confirm",
      details: [
        { label: "pullRequest", value: "MOB/app#42" },
        { label: "yes", value: "confirm without asking" },
      ],
      consequence:
        "Approve a pull request, as you, as xuefu pr approve would, without asking again.",
      confirmLabel: "Allow",
    });
    const needsWork = { ...APPROVE, name: "pr_needs_work" };
    expect(approvalPrompt("Claude", [needsWork], "mcp__xuefu__pr_needs_work", {}).title).toBe(
      "Let Claude run pr needs-work",
    );
  });

  test("another tool by its name; long or structured values on one short line", () => {
    const prompt = approvalPrompt("Claude", [DIFF], "Read", {
      file_path: "/etc/hosts",
      lines: { from: 1, to: 2 },
      note: `${"word ".repeat(40)}\nend`,
    });
    expect(prompt.title).toBe("Let Claude use Read");
    expect(prompt.consequence).toBe("Claude uses its Read tool with what is shown.");
    expect(prompt.details[1]).toEqual({ label: "lines", value: '{"from":1,"to":2}' });
    expect(prompt.details[2]?.value).toHaveLength(160);
    expect(prompt.details[2]?.value.endsWith("…")).toBe(true);
    expect(approvalPrompt("Claude", [], "Glob", {}).details).toEqual([
      { label: "With", value: "nothing" },
    ]);
  });
});

const DAY_MS = 24 * 60 * 60 * 1000;
const MOBILE: Workspace = {
  id: "mobile" as WorkspaceId,
  name: "Mobile" as WorkspaceName,
  path: "/tmp" as AbsolutePath,
  group: null,
  addedAt: 0 as Timestamp,
  lastActiveAt: null,
};
const GRAF: AgentServer = { name: "graf", command: "graf", args: ["serve", "--db", "/g.db"] };

/** An agent that does nothing on its own: the test speaks for it, as its MCP client. */
function fakeRunner(fails = false, id = "claude", name = "Claude") {
  const launches: AgentLaunch[] = [];
  const stopped: string[] = [];
  const sent: string[] = [];
  let emit: (event: AgentEvent) => void = () => undefined;
  let ask: (prompt: ConfirmationPrompt) => Promise<boolean> = () => Promise.resolve(false);
  const runner: AgentRunner = {
    id,
    name,
    models: () => Promise.resolve(ok([{ id: null, name: `${name}'s default` }])),
    start(launch, onEvent, approve) {
      if (fails) return err(processError("Unable to run claude", "claude", null));
      launches.push(launch);
      emit = onEvent;
      ask = approve;
      const session: AgentSession = {
        send: (text) => sent.push(text),
        stop: () => stopped.push(launch.prompt),
      };
      return ok(session);
    },
  };
  return {
    runner,
    launches,
    stopped,
    sent,
    emit: (event: AgentEvent) => emit(event),
    approve: (prompt: ConfirmationPrompt) => ask(prompt),
  };
}

/** Choices kept in memory, failing to keep when told to. */
function memoryChoices(kept: AgentChoice | null = null, broken = false) {
  const saved: AgentChoice[] = [];
  const choices: AgentChoices = {
    load: () => kept,
    save: (choice) => {
      if (broken) {
        return err(fileSystemError("Unable to keep the agent chosen", "/agent.json", "write"));
      }
      saved.push(choice);
      return ok(undefined);
    },
  };
  return { choices, saved };
}

/** Briefs kept in memory, failing to read or keep when told to. */
function memoryBriefs(kept: ProjectBrief | null = null, broken = false) {
  const saved: ProjectBrief[] = [];
  const failure = fileSystemError("Unable to keep the project brief", "/b.json", "write");
  const briefs: ProjectBriefs = {
    find: () => (broken ? err(failure) : ok(kept)),
    save: (brief) => {
      if (broken) return err(failure);
      saved.push(brief);
      return ok(undefined);
    },
  };
  return { briefs, saved };
}

/** A code graph that is ready at once, or fails as told. */
function fakeGraph(created: boolean, fails = false): CodeGraph {
  return {
    prepare: () =>
      Promise.resolve(
        fails
          ? err(
              processError("graf could not index Mobile", "graf", 1, {
                hint: "error: unsupported",
              }),
            )
          : ok({ server: GRAF, created, files: 347 }),
      ),
  };
}

/** Waits for what the host does after a moment, such as preparing the graph. */
async function until(done: () => boolean) {
  for (let tries = 0; tries < 100 && !done(); tries += 1) await Bun.sleep(1);
  expect(done()).toBe(true);
}

const FRESH: ProjectBrief = {
  workspaceId: MOBILE.id,
  text: "Mobile is a Kotlin app.",
  createdAt: (Date.UTC(2026, 9, 6, 9, 0, 0) - 3 * DAY_MS) as Timestamp,
};

/** XueFu's own `pr comment`, as agents get it. */
const COMMENT = mcpTools(PLUGIN_COMMANDS).find((tool) => tool.name === "pr_comment") as McpTool;

/** The pull request's diff, as `pr diff` prints it: what the reviews below comment on. */
const PULL_DIFF = [
  "diff --git a/app/src/main/java/Login.kt b/app/src/main/java/Login.kt",
  "--- a/app/src/main/java/Login.kt",
  "+++ b/app/src/main/java/Login.kt",
  "@@ -10,2 +10,3 @@",
  " fun login() {",
  "+    authenticate()",
  "     prompt()",
  "diff --git a/app/src/Pin.kt b/app/src/Pin.kt",
  "--- a/app/src/Pin.kt",
  "+++ b/app/src/Pin.kt",
  "@@ -4,1 +3,0 @@",
  "-    limit(3)",
  "diff --git a/README.md b/README.md",
  "--- a/README.md",
  "+++ b/README.md",
  "@@ -1,1 +1,2 @@",
  " # App",
  "+Link docs.",
  "diff --git a/a.kt b/a.kt",
  "--- a/a.kt",
  "+++ b/a.kt",
  "@@ -98,1 +98,2 @@",
  " x",
  "+y",
  "",
].join("\n");

/**
 * XueFu's tools, `pr comment` among them if `commenting`; a run fails when `fails` says, and
 * `pr diff` prints `diff`.
 */
function tools(
  commenting = false,
  fails: (argv: readonly string[]) => boolean = () => false,
  diff: string | null = PULL_DIFF,
): McpTools & { ran: (readonly string[])[] } {
  const ran: (readonly string[])[] = [];
  return {
    version: "9.9.9",
    tools: [DIFF, APPROVE, ...(commenting ? [COMMENT] : [])],
    ran,
    run: (argv) => {
      ran.push(argv);
      if (argv[1] === "diff") {
        return Promise.resolve(
          diff === null
            ? { code: 69, stdout: "", stderr: "Bitbucket answered 406\n" }
            : { code: 0, stdout: diff, stderr: "" },
        );
      }
      return Promise.resolve(
        fails(argv)
          ? {
              code: 65,
              stdout: "",
              stderr: "Comment is invalid\nline: line 99 is not in the diff\n",
            }
          : { code: 0, stdout: `ran ${argv.join(" ")}\n`, stderr: "" },
      );
    },
  };
}

interface Setup {
  readonly guidance?: WorkspaceGuidance;
  readonly answers?: boolean[];
  readonly prompt?: string | null;
  readonly graph?: CodeGraph | null;
  readonly kept?: ProjectBrief | null;
  readonly broken?: boolean;
  readonly fails?: boolean;
  readonly setup?: CodeGraphSetup | null;
  /** XueFu's PR commands are on, so reviews can be posted. */
  readonly commenting?: boolean;
  readonly runFails?: (argv: readonly string[]) => boolean;
  /** What `pr diff` prints; null when it cannot be read. */
  readonly diff?: string | null;
  /** What the user posts of a drafted review; all of it by default. */
  readonly pick?: (draft: DraftReview) => readonly DraftComment[];
  /** Where the question is asked; Mobile by default, null for no workspace. */
  readonly workspace?: Workspace | null;
  /** A branch to check out for the conversation; none by default. */
  readonly branch?: string | null;
  readonly checkout?: BranchCheckout;
}

/** Checks out a branch as told: saying so, then putting back; or holding until released. */
function fakeCheckout(options: { held?: boolean; nothingToPutBack?: boolean } = {}) {
  const asked: string[] = [];
  const putBack: string[] = [];
  let release: () => void = () => undefined;
  const checkout: BranchCheckout = {
    checkout: async (folder, branch, say) => {
      asked.push(`${folder} ${branch}`);
      if (options.held === true) await new Promise<void>((resolve) => (release = resolve));
      say(`Checked out ${branch}.`, false);
      if (options.nothingToPutBack === true) return null;
      return () => {
        putBack.push(branch);
        return Promise.resolve(ok("Back on main."));
      };
    },
  };
  return { checkout, asked, putBack, release: () => release() };
}

const ELSEWHERE = "/data/agent" as AbsolutePath;

/** An installer for graf that records what it was asked, installing or failing as told. */
function fakeSetup(options: { declined?: boolean; installs?: boolean; remembers?: boolean } = {}) {
  let declined = options.declined ?? false;
  let installs = 0;
  const setup: CodeGraphSetup = {
    name: "graf",
    command: "curl -fsSL https://example.test/install.sh | sh",
    url: "https://github.com/ctxrs/graf",
    declined: () => declined,
    decline: () => {
      if (options.remembers === false) {
        return err(fileSystemError("Unable to remember not to install graf", "/d", "write"));
      }
      declined = true;
      return ok(undefined);
    },
    install: () => {
      installs += 1;
      return Promise.resolve(
        options.installs === false
          ? err(processError("graf could not be installed", "sh", 1, { hint: "curl: (6)" }))
          : ok(fakeGraph(true)),
      );
    },
  };
  return { setup, declined: () => declined, installs: () => installs };
}

/** Asks the host, answering approvals as `answers` says. */
function asking(setup: Setup = {}) {
  const answers = setup.answers ?? [];
  const fake = fakeRunner(setup.fails);
  const served = tools(setup.commenting, setup.runFails, setup.diff);
  const memory = memoryBriefs(setup.kept === undefined ? FRESH : setup.kept, setup.broken);
  const clock = new ManualClock();
  const asked: ConfirmationPrompt[] = [];
  const reviewed: DraftReview[] = [];
  const events: AgentEvent[] = [];
  const putBack: PutBack[] = [];
  const host = agentHost({
    runners: [fake.runner],
    choices: memoryChoices().choices,
    tools: served,
    graph: setup.graph ?? null,
    setup: setup.setup ?? null,
    briefs: memory.briefs,
    guidance: setup.guidance ?? { read: () => ok(null) },
    elsewhere: ELSEWHERE,
    checkout: setup.checkout ?? fakeCheckout().checkout,
    clock,
  });
  const ask = (into: AgentEvent[]) =>
    host.ask(
      {
        workspace: setup.workspace === undefined ? MOBILE : setup.workspace,
        prompt: setup.prompt === undefined ? "Review MOB/app#42" : setup.prompt,
        branch: setup.branch ?? null,
      },
      {
        onEvent: (event) => into.push(event),
        approve: (prompt) => {
          asked.push(prompt);
          return Promise.resolve(answers.shift() ?? false);
        },
        review: (draft) => {
          reviewed.push(draft);
          return Promise.resolve(setup.pick?.(draft) ?? draft.comments);
        },
        putBack: (done) => putBack.push(done),
      },
    );
  const started = ask(events);
  return {
    host,
    fake,
    served,
    started,
    asked,
    reviewed,
    events,
    clock,
    saved: memory.saved,
    ask,
    putBack,
  };
}

const steps = (events: readonly AgentEvent[]) =>
  events.flatMap((event) =>
    event.kind === "step" ? [event.failed ? `! ${event.text}` : event.text] : [],
  );

/** Starts a conversation, with a fresh brief, and a way to call its endpoint. */
async function session(answers: boolean[] = [], setup: Setup = {}) {
  const { fake, ...rest } = asking({ answers, ...setup });
  await until(() => fake.launches.length === 1);
  const launch = fake.launches[0] as AgentLaunch;
  let id = 0;
  const post = (body: string, headers: Record<string, string> = {}) =>
    fetch(launch.mcp.url, {
      method: "POST",
      headers: { authorization: `Bearer ${launch.mcp.token}`, ...headers },
      body,
    });
  const rpc = async (method: string, params?: object) => {
    id += 1;
    const response = await post(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
    return response.json() as Promise<{ result: Record<string, unknown> }>;
  };
  const call = async (name: string, args: object) =>
    (await rpc("tools/call", { name, arguments: args })).result;
  return { fake, ...rest, launch, post, rpc, call };
}

const decision = (result: Record<string, unknown>) =>
  JSON.parse((result["content"] as { text: string }[])[0]?.text ?? "");

describe("agentHost", () => {
  test("loads project guidance and persona fresh for each conversation", async () => {
    let persona = "Use casual Indonesian comments.";
    const guidance: WorkspaceGuidance = {
      read: (_root, name) => ok(name === "AGENTS.md" ? "Use TDD." : persona),
    };
    const current = await session([], { guidance });
    expect(current.launch.instructions).toContain("Use TDD.");
    expect(current.launch.instructions).toContain(persona);
    current.fake.emit({ kind: "exit", message: null });
    persona = "Use English comments.";
    current.ask([]);
    await until(() => current.fake.launches.length === 2);
    expect(current.fake.launches[1]?.instructions).toContain(persona);
    expect(current.fake.launches[1]?.instructions).not.toContain("Use casual Indonesian comments.");
    current.fake.emit({ kind: "exit", message: null });
  });

  test("reports unreadable guidance and keeps the other file", async () => {
    const current = await session([], {
      guidance: {
        read: (_root, name) =>
          name === "AGENTS.md"
            ? err(fileSystemError("Unable to read AGENTS.md", "/tmp/AGENTS.md", "read"))
            : ok("Use Indonesian comments."),
      },
    });
    expect(steps(current.events)).toContain("! Unable to read AGENTS.md");
    expect(current.launch.instructions).toContain("Use Indonesian comments.");
    current.fake.emit({ kind: "exit", message: null });
  });

  test("without a workspace, no project guidance or persona is read", async () => {
    const current = await session([], {
      workspace: null,
      guidance: {
        read: () => {
          throw new Error("must not read another workspace");
        },
      },
    });
    expect(current.launch.instructions).not.toContain("PERSONA.md");
    current.fake.emit({ kind: "exit", message: null });
  });
  test("starts the agent with its own endpoint, its reads free and the rest asked", async () => {
    const { host, launch, rpc, fake, events } = await session();
    expect(host.name).toBe("Claude");
    expect(launch).toMatchObject({
      cwd: "/tmp",
      prompt: "Review MOB/app#42",
      readTools: ["pr_diff"],
      approvalTool: "approval",
      servers: [],
    });
    expect(launch.mcp.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/mcp$/);
    expect(launch.instructions).toContain("pass yes set to true");
    // What it learned of the workspace before, without a graph to use.
    expect(launch.instructions).toContain("Mobile is a Kotlin app.");
    expect(launch.instructions).not.toContain("graf");
    expect(steps(events)).toEqual(["Using what Claude learned of Mobile 3 days ago."]);

    const init = await rpc("initialize", { protocolVersion: "2025-06-18" });
    expect(init.result["instructions"]).toContain("pass yes set to true");
    const listed = (await rpc("tools/list")).result["tools"] as { name: string }[];
    expect(listed.map((tool) => tool.name)).toEqual(["pr_diff", "pr_approve", "approval"]);
    fake.emit({ kind: "exit", message: null });
  });

  test("a settled review is shown to the user, and what they choose is posted on its lines", async () => {
    const LOGIN = {
      // Cut short, as agents write paths: the diff has it under app/src/main/java.
      file: "app/src/Login.kt",
      line: 11,
      text: "Await authenticate() before prompt().",
      suggestion: "    authenticate().await()\n",
    };
    const { launch, rpc, call, served, reviewed, fake, events } = await session([], {
      commenting: true,
      // The user leaves out the last.
      pick: (draft) => draft.comments.slice(0, 2),
    });
    expect(launch.readTools).toContain("post_comments");
    const listed = (await rpc("tools/list")).result["tools"] as { name: string }[];
    expect(listed.map((tool) => tool.name).slice(-2)).toEqual(["approval", "post_comments"]);

    const posted = await call("post_comments", {
      pullRequest: "MOB/app#42",
      comments: [
        LOGIN,
        { file: "app/src/Pin.kt", line: 4, old: true, text: " Why was the limit removed? " },
        { file: "README.md", line: 2, text: "Link docs/login.md.", suggestion: "  " },
      ],
    });
    expect(reviewed).toEqual([
      {
        pullRequest: "MOB/app#42",
        comments: [
          { ...LOGIN, file: "app/src/main/java/Login.kt", old: false },
          {
            file: "app/src/Pin.kt",
            line: 4,
            old: true,
            text: "Why was the limit removed?",
            suggestion: null,
          },
          { file: "README.md", line: 2, old: false, text: "Link docs/login.md.", suggestion: null },
        ],
      },
    ]);
    expect(served.ran).toEqual([
      // Each comment is placed on the diff before the user is shown them.
      ["pr", "diff", "--", "MOB/app#42"],
      [
        "pr",
        "comment",
        "--message=Await authenticate() before prompt().\n\n```suggestion\n    authenticate().await()\n```",
        "--file=app/src/main/java/Login.kt",
        "--line=11",
        "--yes",
        "--",
        "MOB/app#42",
      ],
      [
        "pr",
        "comment",
        "--message=Why was the limit removed?",
        "--file=app/src/Pin.kt",
        "--line=4",
        "--old",
        "--yes",
        "--",
        "MOB/app#42",
      ],
    ]);
    expect(posted).toEqual({
      content: [
        {
          type: "text",
          text:
            "Posted on app/src/main/java/Login.kt:11.\nPosted on app/src/Pin.kt:4.\n" +
            "The user left out 1 of them.",
        },
      ],
    });
    // The user sees how far it is, and what became of each, as it posts.
    expect(events.slice(1)).toEqual([
      { kind: "posting", done: 0, of: 2 },
      { kind: "step", text: "Posted on app/src/main/java/Login.kt:11", failed: false },
      { kind: "posting", done: 1, of: 2 },
      { kind: "step", text: "Posted on app/src/Pin.kt:4", failed: false },
      { kind: "posting", done: 2, of: 2 },
    ]);
    fake.emit({ kind: "exit", message: null });
  });

  test("a review posted with nothing chosen, or not all posted, says so", async () => {
    const none = await session([], { commenting: true, pick: () => [] });
    const comment = { file: "a.kt", line: 99, text: "Hm." };
    expect(
      await none.call("post_comments", { pullRequest: "MOB/app#42", comments: [comment] }),
    ).toEqual({
      content: [
        { type: "text", text: "The user posted none of them. Ask what they would change." },
      ],
    });
    expect(none.served.ran).toEqual([["pr", "diff", "--", "MOB/app#42"]]);
    none.fake.emit({ kind: "exit", message: null });

    const failing = await session([], { commenting: true, runFails: () => true });
    const said = await failing.call("post_comments", {
      pullRequest: "MOB/app#42",
      comments: [comment],
    });
    expect((said["content"] as { text: string }[])[0]?.text).toBe(
      "Could not post on a.kt:99: line: line 99 is not in the diff",
    );
    failing.fake.emit({ kind: "exit", message: null });
  });

  test("comments off the diff go back to the agent, saying what would place them", async () => {
    const { call, reviewed, served, fake } = await session([], { commenting: true });
    const said = await call("post_comments", {
      pullRequest: "MOB/app#42",
      comments: [
        { file: "README.md", line: 2, text: "Fine." },
        { file: "feature/…/Login.kt", line: 40, text: "Off the diff." },
        { file: "app/src/Pin.kt", line: 9, old: true, text: "Not removed." },
        { file: "Settings.kt", line: 1, text: "Not changed." },
      ],
    });
    expect(said["isError"]).toBe(true);
    expect((said["content"] as { text: string }[])[0]?.text).toBe(
      [
        "Nothing was shown to the user yet. Put each of these on a line the diff shows, with its",
        "whole path, then call post_comments again with all the comments:",
        "comment 2: feature/…/Login.kt is not in the diff; did you mean app/src/main/java/Login.kt?",
        "comment 3: line 9 of app/src/Pin.kt as it was is not removed in the diff, which removes lines 4",
        "comment 4: Settings.kt is not in the diff",
      ].join("\n"),
    );
    // The user is asked nothing, and nothing is posted.
    expect(reviewed).toEqual([]);
    expect(served.ran).toEqual([["pr", "diff", "--", "MOB/app#42"]]);
    fake.emit({ kind: "exit", message: null });
  });

  test("without the diff, the review is shown as drafted, and posting says what fails", async () => {
    const { call, reviewed, fake } = await session([], { commenting: true, diff: null });
    await call("post_comments", {
      pullRequest: "MOB/app#42",
      comments: [{ file: "app/src/Login.kt", line: 11, text: "Hm." }],
    });
    expect(reviewed[0]?.comments[0]?.file).toBe("app/src/Login.kt");
    fake.emit({ kind: "exit", message: null });
  });

  test("a review drafted wrong is sent back, saying what is wrong", async () => {
    const { call, reviewed, fake } = await session([], { commenting: true });
    const wrong = async (args: object) => {
      const result = await call("post_comments", args);
      expect(result["isError"]).toBe(true);
      return (result["content"] as { text: string }[])[0]?.text;
    };
    expect(await wrong({ comments: [] })).toBe("pullRequest is needed, as PROJECT/repository#id");
    expect(await wrong({ pullRequest: "MOB/app#42" })).toBe(
      "comments is needed: at least one comment to post",
    );
    expect(await wrong({ pullRequest: "MOB/app#42", comments: [{ line: 1, text: "x" }] })).toBe(
      "comment 1 needs the file it is on",
    );
    const at = (line: unknown) => ({
      pullRequest: "p",
      comments: [{ file: "f", line, text: "x" }],
    });
    expect(await wrong(at(0))).toBe("comment 1 needs its line, a whole number from 1");
    expect(await wrong(at(1.5))).toBe("comment 1 needs its line, a whole number from 1");
    expect(await wrong(at("3"))).toBe("comment 1 needs its line, a whole number from 1");
    expect(
      await wrong({ pullRequest: "p", comments: [{ file: "f", line: 1, text: " " }, null] }),
    ).toBe("comment 1 needs its text");
    expect(reviewed).toEqual([]);
    fake.emit({ kind: "exit", message: null });
  });

  test("without XueFu's PR commands, there is no review to post", async () => {
    const { launch, rpc, reviewed, fake } = await session();
    expect(launch.readTools).not.toContain("post_comments");
    const listed = (await rpc("tools/list")).result["tools"] as { name: string }[];
    expect(listed.map((tool) => tool.name)).not.toContain("post_comments");
    // An unknown tool, as to any MCP client.
    const unknown = await rpc("tools/call", { name: "post_comments", arguments: {} });
    expect(unknown).toMatchObject({ error: { code: -32602 } });
    expect(reviewed).toEqual([]);
    fake.emit({ kind: "exit", message: null });
  });

  test("only the agent it started gets in, and only by POST to its endpoint", async () => {
    const { launch, post, fake } = await session();
    const ping = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" });
    expect((await fetch(launch.mcp.url, { method: "POST", body: ping })).status).toBe(401);
    expect((await post(ping, { authorization: "Bearer guess" })).status).toBe(401);
    expect((await fetch(launch.mcp.url.replace("/mcp", "/other"))).status).toBe(404);
    const get = await fetch(launch.mcp.url, {
      headers: { authorization: `Bearer ${launch.mcp.token}` },
    });
    expect(get.status).toBe(405);
    expect(get.headers.get("allow")).toBe("POST");
    const note = await post(
      JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
    );
    expect(note.status).toBe(202);
    expect(await (await post("{oops")).json()).toMatchObject({ error: { code: -32700 } });
    fake.emit({ kind: "exit", message: null });
  });

  test("reads run freely; a change runs once the user allows it, and only that once", async () => {
    const { call, asked, served, fake, events } = await session([true]);
    expect(await call("pr_diff", { pullRequest: "MOB/app#42" })).toMatchObject({ isError: false });

    const input = { yes: true, pullRequest: "MOB/app#42" };
    const allowed = await call("approval", { tool_name: "mcp__xuefu__pr_approve", input });
    expect(decision(allowed)).toEqual({ behavior: "allow", updatedInput: input });
    expect(asked.map((prompt) => prompt.title)).toEqual(["Let Claude run pr approve"]);

    // The arguments in any order are the same call; it runs without asking again, once.
    expect(await call("pr_approve", { pullRequest: "MOB/app#42", yes: true })).toMatchObject({
      isError: false,
    });
    expect(asked).toHaveLength(1);
    // Again, it is asked again; declined, it does not run.
    expect(await call("pr_approve", { pullRequest: "MOB/app#42", yes: true })).toEqual({
      content: [{ type: "text", text: "The user did not allow it." }],
      isError: true,
    });
    expect(asked).toHaveLength(2);
    expect(served.ran).toEqual([
      ["pr", "diff", "--", "MOB/app#42"],
      ["pr", "approve", "--yes"],
    ]);

    fake.emit({ kind: "text", text: "Approved." });
    fake.emit({ kind: "exit", message: null });
    expect(events.slice(1)).toEqual([
      { kind: "text", text: "Approved." },
      { kind: "exit", message: null },
    ]);
  });

  test("a change called without the approval tool is asked of the user then", async () => {
    const { call, asked, served, fake } = await session([true]);
    expect(await call("pr_approve", { pullRequest: "MOB/app#42" })).toMatchObject({
      isError: false,
    });
    expect(asked.map((prompt) => prompt.title)).toEqual(["Let Claude run pr approve"]);
    expect(served.ran).toEqual([["pr", "approve"]]);
    fake.emit({ kind: "exit", message: null });
  });

  test("a change the user declines is denied, with why, and does not run", async () => {
    const { call, served, fake } = await session([false]);
    const denied = await call("approval", {
      tool_name: "mcp__xuefu__pr_approve",
      input: { pullRequest: "MOB/app#42" },
    });
    expect(decision(denied)).toEqual({ behavior: "deny", message: "The user did not allow it." });
    expect(await call("pr_approve", { pullRequest: "MOB/app#42" })).toMatchObject({
      isError: true,
    });
    // An approval with nothing in it asks about nothing in particular.
    const bare = await call("approval", {});
    expect(decision(bare).behavior).toBe("deny");
    expect(served.ran).toEqual([]);
    fake.emit({ kind: "exit", message: null });
  });

  test("its endpoint closes when the agent stops, and nothing is told after", async () => {
    const { launch, fake, events } = await session();
    fake.emit({ kind: "exit", message: "Invalid API key" });
    fake.emit({ kind: "text", text: "late" });
    expect(events.slice(1)).toEqual([{ kind: "exit", message: "Invalid API key" }]);
    await Bun.sleep(10);
    await expect(fetch(launch.mcp.url, { method: "POST", body: "{}" })).rejects.toThrow();
  });

  test("an agent that cannot start is said so", async () => {
    const { events } = asking({ fails: true });
    await until(() => events.some((event) => event.kind === "exit"));
    expect(events.at(-1)).toEqual({ kind: "exit", message: "Unable to run claude" });
  });

  test("with a code graph, the agent gets graf's tools and is told to use them", async () => {
    const { fake, events } = asking({ graph: fakeGraph(true) });
    await until(() => fake.launches.length === 1);
    expect(fake.launches[0]?.servers).toEqual([GRAF]);
    expect(fake.launches[0]?.instructions).toContain("use impact on the files and symbols");
    expect(steps(events)).toEqual([
      "Indexed 347 files of Mobile into a code graph with graf.",
      "Using what Claude learned of Mobile 3 days ago.",
    ]);
    const updated = asking({ graph: fakeGraph(false) });
    await until(() => updated.fake.launches.length === 1);
    expect(steps(updated.events)[0]).toBe("The code graph of Mobile is up to date (347 files).");
  });

  test("without graf, it offers to install it, then uses its graph from then on", async () => {
    const graf = fakeSetup();
    const { fake, events, asked, ask } = asking({ setup: graf.setup, answers: [true] });
    await until(() => fake.launches.length === 1);
    expect(asked).toEqual([
      {
        title: "Install graf",
        severity: "confirm",
        details: [
          { label: "Runs", value: "curl -fsSL https://example.test/install.sh | sh" },
          { label: "About", value: "https://github.com/ctxrs/graf" },
        ],
        consequence:
          "graf keeps a graph of each workspace's code on this machine, so Claude can follow " +
          "what calls what and what a change affects. Without it, Claude studies the code by " +
          "reading it, and you are not asked again.",
        confirmLabel: "Install",
      },
    ]);
    expect(steps(events).slice(0, 3)).toEqual([
      "Installing graf…",
      "Installed graf.",
      "Indexed 347 files of Mobile into a code graph with graf.",
    ]);
    expect(fake.launches[0]?.servers).toEqual([GRAF]);

    const later: AgentEvent[] = [];
    ask(later);
    await until(() => fake.launches.length === 2);
    expect(graf.installs()).toBe(1);
    expect(asked).toHaveLength(1);
    expect(fake.launches[1]?.servers).toEqual([GRAF]);
  });

  test("declined, Claude reads the code itself, and graf is not offered again", async () => {
    const graf = fakeSetup();
    const { fake, events, asked } = asking({ setup: graf.setup, kept: null, answers: [false] });
    await until(() => fake.launches.length === 1);
    expect(graf.declined()).toBe(true);
    expect(graf.installs()).toBe(0);
    expect(fake.launches[0]?.servers).toEqual([]);
    expect(fake.launches[0]?.prompt).toContain("Study this project");
    expect(steps(events)[0]).toBe(
      "Without graf, Claude reads the code itself. To have it later: https://github.com/ctxrs/graf",
    );

    const again = asking({ setup: graf.setup });
    await until(() => again.fake.launches.length === 1);
    expect(again.asked).toEqual([]);
    expect(asked).toHaveLength(1);
  });

  test("an install or a decline that fails is said so, and the agent goes on", async () => {
    const failing = asking({ setup: fakeSetup({ installs: false }).setup, answers: [true] });
    await until(() => failing.fake.launches.length === 1);
    expect(failing.fake.launches[0]?.servers).toEqual([]);
    expect(steps(failing.events)[1]).toBe("! graf could not be installed: curl: (6)");

    const forgetful = asking({ setup: fakeSetup({ remembers: false }).setup });
    await until(() => forgetful.fake.launches.length === 1);
    expect(steps(forgetful.events)[0]).toBe(
      "! Without graf; Unable to remember not to install graf",
    );
  });

  test("with no workspace holding the code, it works from XueFu's tools in an empty folder", async () => {
    let prepared = 0;
    const graph: CodeGraph = {
      prepare: () => {
        prepared += 1;
        return fakeGraph(false).prepare(MOBILE);
      },
    };
    const { fake, events } = asking({ workspace: null, graph, kept: null });
    await until(() => fake.launches.length === 1);
    const launch = fake.launches[0] as AgentLaunch;
    // Nothing to graph or study: straight to the conversation.
    expect(prepared).toBe(0);
    expect(launch.prompt).toBe("Review MOB/app#42");
    expect(launch.cwd).toBe(ELSEWHERE);
    expect(launch.servers).toEqual([]);
    expect(launch.instructions).toContain("this folder is empty: read the changes through");
    expect(steps(events)).toEqual([
      "No workspace holds this code, so Claude works from XueFu's tools alone.",
    ]);

    const studying = asking({ workspace: null, prompt: null });
    await until(() => studying.events.some((event) => event.kind === "exit"));
    expect(studying.fake.launches).toEqual([]);
  });

  test("a graph that cannot be made is said so, and the agent goes on without it", async () => {
    const { fake, events } = asking({ graph: fakeGraph(true, true) });
    await until(() => fake.launches.length === 1);
    expect(fake.launches[0]?.servers).toEqual([]);
    expect(steps(events)[0]).toBe("! No code graph: error: unsupported");
  });

  test("a workspace it has not learned is studied first, and what it learns is kept", async () => {
    const { fake, events, saved, clock } = asking({ kept: null, graph: fakeGraph(false) });
    await until(() => fake.launches.length === 1);
    const study = fake.launches[0] as AgentLaunch;
    expect(study.prompt).toContain("Study this project");
    expect(study.prompt).toContain("graf's tools");
    expect(study.servers).toEqual([GRAF]);

    // Only the tools it uses show while it studies; its brief is kept, not shown.
    fake.emit({ kind: "ready", model: "claude-opus" });
    fake.emit({ kind: "tool", name: "graf_god_nodes", input: {} });
    fake.emit({ kind: "text", text: "Looking around." });
    fake.emit({ kind: "text", text: "Mobile is a Kotlin app, layered." });
    clock.advance(1000);
    fake.emit({ kind: "turn", costUsd: 0.4, failed: null });
    await until(() => fake.launches.length === 2);
    expect(fake.stopped).toEqual([study.prompt]);
    fake.emit({ kind: "exit", message: null });

    expect(saved).toEqual([
      {
        workspaceId: MOBILE.id,
        text: "Mobile is a Kotlin app, layered.",
        createdAt: (Date.UTC(2026, 9, 6, 9, 0, 0) + 1000) as Timestamp,
      },
    ]);
    const conversation = fake.launches[1] as AgentLaunch;
    expect(conversation.prompt).toBe("Review MOB/app#42");
    expect(conversation.instructions).toContain(
      "What you learned of Mobile when you studied it today:\n\nMobile is a Kotlin app, layered.",
    );
    expect(events.filter((event) => event.kind !== "step")).toEqual([
      { kind: "tool", name: "graf_god_nodes", input: {} },
      { kind: "exit", message: null },
    ]);
    expect(steps(events)).toEqual([
      "The code graph of Mobile is up to date (347 files).",
      "Studying Mobile first; what Claude learns is kept for next time.",
      "Learned Mobile, $0.40; kept for next time.",
    ]);
  });

  test("a brief two weeks old is studied again", async () => {
    const old = asking({
      kept: { ...FRESH, createdAt: (FRESH.createdAt - 11 * DAY_MS) as Timestamp },
    });
    await until(() => old.fake.launches.length === 1);
    expect(old.fake.launches[0]?.prompt).toContain("Study this project");
    expect(old.fake.launches[0]?.prompt).not.toContain("graf");
  });

  test("a study that fails is said so; the conversation starts without a brief", async () => {
    const { fake, events, saved } = asking({ kept: null });
    await until(() => fake.launches.length === 1);
    fake.emit({ kind: "text", text: "partial" });
    fake.emit({ kind: "turn", costUsd: 0.1, failed: "Credit balance is too low" });
    await until(() => fake.launches.length === 2);
    expect(saved).toEqual([]);
    expect(fake.launches[1]?.instructions).not.toContain("What you learned");
    expect(steps(events).at(-1)).toBe("! It could not study Mobile: Credit balance is too low");
  });

  test("a study the agent leaves early is said so", async () => {
    const { fake, events } = asking({ kept: null });
    await until(() => fake.launches.length === 1);
    fake.emit({ kind: "exit", message: "Invalid API key" });
    await until(() => fake.launches.length === 2);
    expect(steps(events).at(-1)).toBe("! It could not study Mobile: Invalid API key");
  });

  test("briefs that cannot be read or kept are said so, and the agent goes on", async () => {
    const { fake, events } = asking({ broken: true });
    await until(() => fake.launches.length === 1);
    fake.emit({ kind: "text", text: "Brief." });
    fake.emit({ kind: "turn", costUsd: null, failed: null });
    await until(() => fake.launches.length === 2);
    expect(steps(events)).toEqual([
      "! What Claude learned could not be read: Unable to keep the project brief",
      "Studying Mobile first; what Claude learns is kept for next time.",
      "! Learned Mobile, but it could not be kept: Unable to keep the project brief",
    ]);
  });

  test("studying again only says what it learned, then ends", async () => {
    const { fake, events, saved } = asking({ prompt: null, kept: FRESH });
    await until(() => fake.launches.length === 1);
    expect(fake.launches[0]?.prompt).toContain("Study this project");
    fake.emit({ kind: "text", text: "Mobile, again." });
    fake.emit({ kind: "turn", costUsd: 0.3, failed: null });
    await until(() => events.some((event) => event.kind === "exit"));
    expect(saved.map((brief) => brief.text)).toEqual(["Mobile, again."]);
    expect(fake.launches).toHaveLength(1);
    expect(events.filter((event) => event.kind !== "step")).toEqual([
      { kind: "text", text: "Mobile, again." },
      { kind: "turn", costUsd: 0.3, failed: null },
      { kind: "exit", message: null },
    ]);
  });

  test("what is said while it prepares is sent once the conversation starts", async () => {
    const { fake, started } = asking({ kept: null });
    await until(() => fake.launches.length === 1);
    started.send("and the tests?");
    expect(fake.sent).toEqual([]);
    fake.emit({ kind: "text", text: "Brief." });
    fake.emit({ kind: "turn", costUsd: null, failed: null });
    await until(() => fake.launches.length === 2);
    expect(fake.sent).toEqual(["and the tests?"]);
    started.send("thanks");
    expect(fake.sent).toEqual(["and the tests?", "thanks"]);
  });

  test("a review's branch is checked out first, and put back once the conversation ends", async () => {
    const checkout = fakeCheckout();
    const { events, fake, launch, putBack } = await session([], {
      branch: "feature/MOB-2841",
      checkout: checkout.checkout,
    });
    expect(checkout.asked).toEqual(["/tmp feature/MOB-2841"]);
    expect(launch.cwd).toBe(MOBILE.path);
    expect(steps(events).slice(0, 2)).toEqual([
      "Checking out feature/MOB-2841 in Mobile…",
      "Checked out feature/MOB-2841.",
    ]);
    expect(checkout.putBack).toEqual([]);
    fake.emit({ kind: "exit", message: null });
    await until(() => putBack.length === 1);
    expect(checkout.putBack).toEqual(["feature/MOB-2841"]);
    expect(putBack).toEqual([ok("Back on main.")]);
  });

  test("with nothing to put back, or no workspace, nothing is put back", async () => {
    const already = fakeCheckout({ nothingToPutBack: true });
    const { started, putBack } = await session([], {
      branch: "main",
      checkout: already.checkout,
    });
    started.stop();
    await Bun.sleep(5);
    expect(putBack).toEqual([]);

    const nowhere = fakeCheckout();
    const elsewhere = await session([], {
      branch: "main",
      checkout: nowhere.checkout,
      workspace: null,
    });
    elsewhere.started.stop();
    expect(nowhere.asked).toEqual([]);
  });

  test("stopped while the branch is checked out, it is put back at once", async () => {
    const held = fakeCheckout({ held: true });
    const { fake, started, putBack } = asking({ branch: "feature/x", checkout: held.checkout });
    await until(() => held.asked.length === 1);
    started.stop();
    held.release();
    await until(() => putBack.length === 1);
    expect(fake.launches).toEqual([]);
    expect(held.putBack).toEqual(["feature/x"]);
  });

  test("stopped while it prepares, it ends once and starts nothing more", async () => {
    let release: () => void = () => undefined;
    const graph: CodeGraph = {
      prepare: (_workspace, signal) =>
        new Promise((resolve) => {
          release = () => resolve(ok({ server: GRAF, created: false, files: 1 }));
          signal?.addEventListener("abort", release);
        }),
    };
    const { fake, events, started } = asking({ graph });
    started.stop();
    started.stop();
    release();
    await Bun.sleep(5);
    expect(fake.launches).toEqual([]);
    expect(events).toEqual([{ kind: "exit", message: null }]);

    const studying = asking({ kept: null });
    await until(() => studying.fake.launches.length === 1);
    studying.started.stop();
    expect(studying.fake.stopped).toHaveLength(1);
    studying.fake.emit({ kind: "exit", message: null });
    await Bun.sleep(5);
    expect(studying.fake.launches).toHaveLength(1);
    expect(studying.events.filter((event) => event.kind === "exit")).toHaveLength(1);
  });

  test("the agent may ask the user itself, through the cockpit", async () => {
    const { fake, asked } = await session([true]);
    const prompt = approvalPrompt("Claude", [], "edit", {});
    expect(await fake.approve(prompt)).toBe(true);
    expect(asked).toEqual([prompt]);
    fake.emit({ kind: "exit", message: null });
  });
});

describe("choosing the agent", () => {
  /** Claude and OpenCode installed, with what was chosen before. */
  function choosing(kept: AgentChoice | null = null, broken = false) {
    const claude = fakeRunner();
    const openCode = fakeRunner(false, "opencode", "OpenCode");
    const memory = memoryChoices(kept, broken);
    const host = agentHost({
      runners: [claude.runner, openCode.runner],
      choices: memory.choices,
      tools: tools(),
      graph: null,
      setup: null,
      briefs: memoryBriefs(FRESH).briefs,
      guidance: { read: () => ok(null) },
      elsewhere: ELSEWHERE,
      checkout: fakeCheckout().checkout,
      clock: new ManualClock(),
    });
    const ask = () =>
      host.ask(
        { workspace: MOBILE, prompt: "hello", branch: null },
        {
          onEvent: () => undefined,
          approve: () => Promise.resolve(false),
          review: () => Promise.resolve([]),
          putBack: () => undefined,
        },
      );
    return { host, claude, openCode, saved: memory.saved, ask };
  }

  test("every agent installed, each with its models; none for one it does not know", async () => {
    const { host } = choosing();
    const choices = host.choosing;
    if (choices === undefined) throw new Error("no choosing");
    expect(choices.agents()).toEqual([
      { id: "claude", name: "Claude" },
      { id: "opencode", name: "OpenCode" },
    ]);
    const signal = new AbortController().signal;
    expect(await choices.models("opencode", signal)).toEqual(
      ok([{ id: null, name: "OpenCode's default" }]),
    );
    expect(await choices.models("aider", signal)).toEqual(ok([]));
  });

  test("the first agent on its default, until another is chosen and kept", async () => {
    const { host, claude, openCode, saved, ask } = choosing();
    expect(host.choosing?.current()).toEqual({ agent: "claude", model: null });
    expect([host.name, host.model]).toEqual(["Claude", null]);

    const next = { agent: "opencode", model: "anthropic/claude-opus-5-5" };
    expect(host.choosing?.choose(next)).toEqual(ok(undefined));
    expect(saved).toEqual([next]);
    expect([host.name, host.model]).toEqual(["OpenCode", "anthropic/claude-opus-5-5"]);
    ask();
    await until(() => openCode.launches.length === 1);
    expect(openCode.launches[0]?.model).toBe("anthropic/claude-opus-5-5");
    expect(claude.launches).toEqual([]);
    openCode.emit({ kind: "exit", message: null });
  });

  test("what was kept is used; an agent no longer installed falls back to the first", () => {
    expect(choosing({ agent: "opencode", model: "x/y" }).host.choosing?.current()).toEqual({
      agent: "opencode",
      model: "x/y",
    });
    expect(choosing({ agent: "aider", model: "x/y" }).host.choosing?.current()).toEqual({
      agent: "claude",
      model: null,
    });
  });

  test("a choice that cannot be kept is said so, and changes nothing", () => {
    const { host } = choosing(null, true);
    const chosen = host.choosing?.choose({ agent: "opencode", model: null });
    expect(chosen?.ok).toBe(false);
    expect(host.name).toBe("Claude");
  });
});
