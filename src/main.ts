import { homedir } from "node:os";
import pkg from "../package.json" with { type: "json" };
import { runCli } from "./bootstrap/run-cli";

process.exitCode = await runCli({
  argv: Bun.argv.slice(2),
  env: process.env,
  home: homedir(),
  cwd: process.cwd(),
  version: pkg.version,
  stdout: process.stdout,
  stderr: process.stderr,
});
