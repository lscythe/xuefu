import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type {
  ProcessOptions,
  ProcessOutput,
  ProcessRunner,
  ProcessSpec,
} from "../../../../src/application/ports/process-runner";
import { cancelled as cancelledError } from "../../../../src/domain/shared/errors";
import type { WorkspaceId } from "../../../../src/domain/shared/ids";
import type { AbsolutePath } from "../../../../src/domain/shared/path";
import { err, ok } from "../../../../src/domain/shared/result";
import type { Timestamp } from "../../../../src/domain/shared/time";
import type { Workspace, WorkspaceName } from "../../../../src/domain/workspace/workspace";
import { findGraf, grafGraph, grafSetup } from "../../../../src/infrastructure/agent/graf";
import { makeTempDir } from "../../../support/temp-dir";

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

function folders() {
  const temp = makeTempDir();
  cleanups.push(temp.cleanup);
  const path = join(temp.path, "mobile");
  mkdirSync(path);
  const workspace: Workspace = {
    id: "mobile" as WorkspaceId,
    name: "Mobile" as WorkspaceName,
    path: path as AbsolutePath,
    group: null,
    addedAt: 0 as Timestamp,
    lastActiveAt: null,
  };
  return { workspace, cacheDir: join(temp.path, "graf") };
}

/** A process runner that answers every run as told, and keeps what it was asked. */
function scripted(output: Partial<ProcessOutput> = {}) {
  const runs: { spec: ProcessSpec; options: ProcessOptions }[] = [];
  const processes: ProcessRunner = {
    run: (spec, options) => {
      runs.push({ spec, options });
      return Promise.resolve(
        ok({ exitCode: 0, stdout: "", stderr: "", durationMs: 1, truncated: false, ...output }),
      );
    },
  };
  return { processes, runs };
}

describe("grafGraph", () => {
  test("a workspace without a graph of its own is indexed into XueFu's, then updated", async () => {
    const { workspace, cacheDir } = folders();
    const { processes, runs } = scripted({
      stdout: JSON.stringify({ parsed_files: 340, unchanged_files: 7, nodes: 9000 }),
    });
    const graph = grafGraph({ command: "/bin/graf", processes, cacheDir });
    const signal = new AbortController().signal;
    const db = join(cacheDir, "mobile", "index.db");

    const first = await graph.prepare(workspace, signal);
    expect(first).toEqual(
      ok({
        server: { name: "graf", command: "/bin/graf", args: ["serve", "--db", db] },
        created: true,
        files: 347,
      }),
    );
    expect(runs[0]?.spec).toEqual({
      command: "/bin/graf",
      args: ["index", "--code-only", "--db", db, "--json", workspace.path],
      cwd: workspace.path,
    });
    expect(runs[0]?.options).toEqual({ timeoutMs: 600_000, signal });
    // Only you can read it.
    expect(statSync(join(cacheDir, "mobile")).mode & 0o777).toBe(0o700);
    expect(existsSync(join(workspace.path, ".graf"))).toBe(false);

    writeFileSync(db, "");
    const second = await graph.prepare(workspace);
    expect(second.ok && second.value.created).toBe(false);
    expect(runs[1]?.spec.args).toEqual(["update", "--db", db, "--json"]);
    expect(runs[1]?.options).toEqual({ timeoutMs: 600_000 });
  });

  test("a workspace with its own graph keeps using it", async () => {
    const { workspace, cacheDir } = folders();
    const own = join(workspace.path, ".graf", "index.db");
    mkdirSync(join(workspace.path, ".graf"));
    writeFileSync(own, "");
    const { processes, runs } = scripted({ stdout: "not json" });
    const prepared = await grafGraph({ command: "graf", processes, cacheDir }).prepare(workspace);
    expect(runs[0]?.spec.args).toEqual(["update", "--db", own, "--json"]);
    expect(prepared.ok && prepared.value).toMatchObject({ created: false, files: 0 });
    expect(existsSync(cacheDir)).toBe(false);
  });

  test("graf failing says why, from the last line it wrote", async () => {
    const { workspace, cacheDir } = folders();
    const { processes } = scripted({ exitCode: 2, stderr: "warming up\nerror: disk full\n" });
    const failed = await grafGraph({ command: "graf", processes, cacheDir }).prepare(workspace);
    expect(failed.ok).toBe(false);
    if (!failed.ok) {
      expect(failed.error.message).toBe("graf could not index Mobile");
      expect(failed.error.hint).toBe("error: disk full");
    }
    const quiet = scripted({ exitCode: 2 });
    const silent = await grafGraph({
      command: "graf",
      processes: quiet.processes,
      cacheDir,
    }).prepare(workspace);
    expect(!silent.ok && silent.error.message).toBe("graf could not index Mobile");
    expect(!silent.ok && silent.error.hint).toBeUndefined();
  });

  test("found on PATH, or where its installer puts it", () => {
    const temp = makeTempDir();
    cleanups.push(temp.cleanup);
    const bin = join(temp.path, "bin");
    mkdirSync(bin);
    expect(findGraf(bin, temp.path)).toBeNull();
    const installed = join(temp.path, ".local", "bin", "graf");
    mkdirSync(dirname(installed), { recursive: true });
    writeFileSync(installed, "");
    expect(findGraf(bin, temp.path)).toBe(installed);
    writeFileSync(join(bin, "graf"), "#!/bin/sh\n");
    chmodSync(join(bin, "graf"), 0o755);
    expect(findGraf(bin, temp.path)).toBe(join(bin, "graf"));
  });

  test("a run that does not finish is passed on", async () => {
    const { workspace, cacheDir } = folders();
    const cancelled = cancelledError("graf was stopped");
    const processes: ProcessRunner = { run: () => Promise.resolve(err(cancelled)) };
    expect(await grafGraph({ command: "graf", processes, cacheDir }).prepare(workspace)).toEqual(
      err(cancelled),
    );
  });
});

describe("grafSetup", () => {
  function home() {
    const temp = makeTempDir();
    cleanups.push(temp.cleanup);
    return {
      home: temp.path,
      cacheDir: join(temp.path, "data", "graf"),
      declinedFile: join(temp.path, "data", "graf-declined"),
    };
  }
  const ENV = { HTTPS_PROXY: "http://proxy:8080", SECRET_TOKEN: "x", PATH: "/bin" };

  test("installs with graf's own installer, through the proxy, into ~/.local/bin", async () => {
    const paths = home();
    const runs: ProcessSpec[] = [];
    const options: ProcessOptions[] = [];
    const processes: ProcessRunner = {
      run: (spec, given) => {
        runs.push(spec);
        options.push(given);
        // As the installer does.
        mkdirSync(join(paths.home, ".local", "bin"), { recursive: true });
        writeFileSync(join(paths.home, ".local", "bin", "graf"), "");
        return Promise.resolve(
          ok({ exitCode: 0, stdout: "", stderr: "", durationMs: 1, truncated: false }),
        );
      },
    };
    const setup = grafSetup({ processes, env: ENV, ...paths });
    expect(setup.name).toBe("graf");
    expect(setup.url).toBe("https://github.com/ctxrs/graf");
    expect(setup.command).toBe(
      "curl -fsSL https://raw.githubusercontent.com/ctxrs/graf/main/install.sh | sh",
    );
    const signal = new AbortController().signal;
    const installed = await setup.install(signal);
    expect(runs).toEqual([
      {
        command: "sh",
        args: ["-c", setup.command],
        cwd: paths.home as AbsolutePath,
        env: {
          HTTPS_PROXY: "http://proxy:8080",
          GRAF_INSTALL_DIR: join(paths.home, ".local", "bin"),
        },
      },
    ]);
    expect(options).toEqual([{ timeoutMs: 300_000, signal }]);
    expect(installed.ok).toBe(true);

    // The graph it gives runs the graf just installed.
    const { workspace } = folders();
    if (installed.ok) await installed.value.prepare(workspace);
    expect(runs[1]?.command).toBe(join(paths.home, ".local", "bin", "graf"));
    await setup.install();
    expect(options[2]).toEqual({ timeoutMs: 300_000 });
  });

  test("an install that fails says why, or where to install it from", async () => {
    const paths = home();
    const said = scripted({ exitCode: 1, stderr: "error: unsupported platform\n" });
    const failed = await grafSetup({ ...paths, processes: said.processes, env: {} }).install();
    expect(!failed.ok && [failed.error.message, failed.error.hint]).toEqual([
      "graf could not be installed",
      "error: unsupported platform",
    ]);
    // Finished, but graf is not where it should be.
    const quiet = scripted();
    const missing = await grafSetup({ ...paths, processes: quiet.processes, env: {} }).install();
    expect(!missing.ok && missing.error.hint).toBe(
      "Install it yourself: https://github.com/ctxrs/graf",
    );
    const cancelled = cancelledError("stopped");
    const processes: ProcessRunner = { run: () => Promise.resolve(err(cancelled)) };
    expect(await grafSetup({ ...paths, processes, env: {} }).install()).toEqual(err(cancelled));
  });

  test("remembers being declined, in a file only you can read", () => {
    const paths = home();
    const setup = grafSetup({ ...paths, processes: scripted().processes, env: {} });
    expect(setup.declined()).toBe(false);
    expect(setup.decline()).toEqual(ok(undefined));
    expect(setup.declined()).toBe(true);
    expect(statSync(paths.declinedFile).mode & 0o777).toBe(0o600);

    const blocked = grafSetup({
      ...paths,
      declinedFile: join(paths.declinedFile, "inside-a-file"),
      processes: scripted().processes,
      env: {},
    });
    const failed = blocked.decline();
    expect(!failed.ok && failed.error.message).toBe("Unable to remember not to install graf");
  });
});
