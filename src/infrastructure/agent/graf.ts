import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ProcessRunner } from "../../application/ports/process-runner";
import type { CodeGraph, CodeGraphSetup } from "../../application/ports/project-context";
import { fileSystemError, processError } from "../../domain/shared/errors";
import type { AbsolutePath } from "../../domain/shared/path";
import { err, fromThrowable, ok } from "../../domain/shared/result";

/** Long enough for a first index of a large repository; an update takes a moment. */
const TIMEOUT_MS = 10 * 60 * 1000;
/** Long enough to download graf on a slow line. */
const INSTALL_TIMEOUT_MS = 5 * 60 * 1000;

const GRAF_URL = "https://github.com/ctxrs/graf";
/** graf's own installer: it checks the release's signature and checksum before installing. */
const INSTALL_COMMAND =
  "curl -fsSL https://raw.githubusercontent.com/ctxrs/graf/main/install.sh | sh";
/** Where graf's installer puts it unless told otherwise. */
const installDir = (home: string) => join(home, ".local", "bin");
/** What the download needs beyond what every child gets: the proxy and certificates. */
const NETWORK_ENV = [
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "NO_PROXY",
  "http_proxy",
  "https_proxy",
  "no_proxy",
  "SSL_CERT_FILE",
  "SSL_CERT_DIR",
  "CURL_CA_BUNDLE",
];

/** graf, on PATH or where its installer puts it; null when it is not installed. */
export function findGraf(path: string, home: string): string | null {
  const installed = join(installDir(home), "graf");
  return Bun.which("graf", { PATH: path }) ?? (existsSync(installed) ? installed : null);
}

/** What `graf index` and `graf update` report, as far as XueFu reads it. */
function fileCount(stdout: string): number {
  try {
    const report = JSON.parse(stdout) as Record<string, unknown>;
    const parsed = typeof report["parsed_files"] === "number" ? report["parsed_files"] : 0;
    const unchanged = typeof report["unchanged_files"] === "number" ? report["unchanged_files"] : 0;
    return parsed + unchanged;
  } catch {
    return 0;
  }
}

export interface GrafOptions {
  /** Where graf is: on PATH, found when XueFu starts. */
  readonly command: string;
  readonly processes: ProcessRunner;
  /** Where XueFu keeps the graphs of workspaces that have none of their own. */
  readonly cacheDir: string;
}

/**
 * Code graphs kept by graf: a local SQLite graph of a workspace's code, built once and brought up
 * to date incrementally, served to agents over MCP with read-only tools.
 * A workspace with its own `.graf/index.db` keeps using it; any other gets one in XueFu's data
 * folder, so its repository is not touched. Code only: nothing is sent anywhere.
 */
export function grafGraph(options: GrafOptions): CodeGraph {
  return {
    async prepare(workspace, signal) {
      const own = join(workspace.path, ".graf", "index.db");
      const db = existsSync(own) ? own : join(options.cacheDir, workspace.id, "index.db");
      const created = !existsSync(db);
      if (created) mkdirSync(dirname(db), { recursive: true, mode: 0o700 });
      const ran = await options.processes.run(
        {
          command: options.command,
          args: created
            ? ["index", "--code-only", "--db", db, "--json", workspace.path]
            : ["update", "--db", db, "--json"],
          cwd: workspace.path,
        },
        { timeoutMs: TIMEOUT_MS, ...(signal === undefined ? {} : { signal }) },
      );
      if (!ran.ok) return ran;
      if (ran.value.exitCode !== 0) {
        const said = ran.value.stderr.trim().split("\n").at(-1) ?? "";
        return err(
          processError(
            `graf could not ${created ? "index" : "update"} ${workspace.name}`,
            options.command,
            ran.value.exitCode,
            said === "" ? {} : { hint: said },
          ),
        );
      }
      return ok({
        server: { name: "graf", command: options.command, args: ["serve", "--db", db] },
        created,
        files: fileCount(ran.value.stdout),
      });
    },
  };
}

export interface GrafSetupOptions {
  readonly processes: ProcessRunner;
  readonly home: string;
  /** XueFu's environment, for the proxy the download goes through. */
  readonly env: Readonly<Record<string, string | undefined>>;
  /** Where the graphs are kept once graf is installed. */
  readonly cacheDir: string;
  /** A file whose being there says the user does not want graf. */
  readonly declinedFile: string;
}

/** Installs graf with its own installer, into `~/.local/bin`, once the user agrees. */
export function grafSetup(options: GrafSetupOptions): CodeGraphSetup {
  const dir = installDir(options.home);
  return {
    name: "graf",
    command: INSTALL_COMMAND,
    url: GRAF_URL,
    declined: () => existsSync(options.declinedFile),
    decline: () =>
      fromThrowable(
        () => {
          mkdirSync(dirname(options.declinedFile), { recursive: true, mode: 0o700 });
          writeFileSync(options.declinedFile, "", { mode: 0o600 });
        },
        (thrown) =>
          fileSystemError("Unable to remember not to install graf", options.declinedFile, "write", {
            cause: thrown,
          }),
      ),
    async install(signal) {
      const network = Object.fromEntries(
        NETWORK_ENV.flatMap((name) => {
          const value = options.env[name];
          return value === undefined ? [] : [[name, value]];
        }),
      );
      const ran = await options.processes.run(
        {
          command: "sh",
          args: ["-c", INSTALL_COMMAND],
          cwd: options.home as AbsolutePath,
          env: { ...network, GRAF_INSTALL_DIR: dir },
        },
        { timeoutMs: INSTALL_TIMEOUT_MS, ...(signal === undefined ? {} : { signal }) },
      );
      if (!ran.ok) return ran;
      const command = join(dir, "graf");
      if (ran.value.exitCode !== 0 || !existsSync(command)) {
        const said = ran.value.stderr.trim().split("\n").at(-1) ?? "";
        return err(
          processError("graf could not be installed", "sh", ran.value.exitCode, {
            hint: said === "" ? `Install it yourself: ${GRAF_URL}` : said,
          }),
        );
      }
      return ok(grafGraph({ command, processes: options.processes, cacheDir: options.cacheDir }));
    },
  };
}
