import { homedir } from "node:os";
import pkg from "../package.json" with { type: "json" };
import { runCli } from "./bootstrap/run-cli";

process.exitCode = await runCli({
  argv: Bun.argv.slice(2),
  env: process.env,
  home: homedir(),
  cwd: process.cwd(),
  version: pkg.version,
  tui: {
    interactive: process.stdin.isTTY === true && process.stdout.isTTY === true,
    // Imported on demand: OpenTUI loads a native library that plain commands do not need.
    createRenderer: async () => {
      const { createCliRenderer } = await import("@opentui/core");
      return createCliRenderer({ exitOnCtrlC: false, useMouse: false, targetFps: 30 });
    },
  },
  stdout: process.stdout,
  stderr: process.stderr,
});
