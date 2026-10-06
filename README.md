# 血符 XueFu

[![CI](https://img.shields.io/github/actions/workflow/status/lscythe/xuefu/ci.yml?branch=main&label=CI&logo=githubactions&labelColor=14141c&logoColor=e8e3d9)](https://github.com/lscythe/xuefu/actions/workflows/ci.yml)
[![Coverage](https://img.shields.io/coverallsCoverage/github/lscythe/xuefu?branch=main&logo=coveralls&labelColor=14141c&logoColor=e8e3d9)](https://coveralls.io/github/lscythe/xuefu?branch=main)
[![Bun](https://img.shields.io/badge/dynamic/toml?url=https://raw.githubusercontent.com/lscythe/xuefu/main/mise.toml&query=%24.tools.bun&label=bun&logo=bun&color=e0a458&labelColor=14141c&logoColor=e8e3d9)](https://bun.sh)
[![TypeScript](https://img.shields.io/badge/dynamic/json?url=https://raw.githubusercontent.com/lscythe/xuefu/main/package.json&query=%24.devDependencies.typescript&label=typescript&logo=typescript&color=7bdff2&labelColor=14141c&logoColor=e8e3d9)](https://www.typescriptlang.org)
[![Conventional Commits](https://img.shields.io/badge/conventional%20commits-1.0.0-b14aed?logo=conventionalcommits&labelColor=14141c&logoColor=e8e3d9)](https://www.conventionalcommits.org)
[![Biome](https://img.shields.io/badge/code%20style-biome-a6f0ff?logo=biome&labelColor=14141c&logoColor=e8e3d9)](https://biomejs.dev)
[![License](https://img.shields.io/github/license/lscythe/xuefu?color=c1121f&labelColor=14141c)](LICENSE)

A terminal-native developer cockpit: Jira, git, pull requests, CI, Android tooling and timesheets
around a single **Work Context**.

> Status: **early development.** The terminal UI is not available yet.

## Usage

```bash
xuefu                                                          # open the cockpit (^W switches workspace, q quits)
xuefu workspace add ~/work/mobile-banking --group "Client A"  # register a project folder
xuefu workspace                                                # list workspaces and detected tools
xuefu workspace which                                          # the workspace containing this folder
xuefu workspace remove mobile-banking --yes                    # stop tracking it; the folder is kept
xuefu diagnostics                                              # paths, config sources, database state
```

Exit codes follow sysexits: `64` usage, `65` conflict, `66` not found, `74` I/O, `78` configuration.
`workspace which` exits `1` outside every workspace, which makes it usable in shell prompts.
The cockpit needs an interactive terminal of at least 80×24; piped or scripted runs exit `64`.

## Development

Requires [mise](https://mise.jdx.dev) and git. `mise.toml` pins Bun, actionlint and shellcheck for
local work and CI alike.

```bash
mise install         # Bun, actionlint, shellcheck
bun install          # also installs git hooks via lefthook
bun run check        # full local quality gate (same as CI)
bun run start -- --help
```

| Script                  | Purpose                                         |
|-------------------------|-------------------------------------------------|
| `bun run test:unit`     | fast, deterministic unit + property tests       |
| `bun run test:integration` | SQLite, filesystem and config integration tests |
| `bun run test:arch`     | layer-boundary and import-cycle enforcement     |
| `bun run test:e2e`      | spawns the real entrypoint against temp dirs    |
| `bun run lint:fix`      | Biome lint + format with autofix                |
| `bun run lint:workflows` | actionlint (with shellcheck) on GitHub workflows |
| `bun run build`         | compile a standalone binary into `dist/`        |

Commits follow [Conventional Commits](https://www.conventionalcommits.org) (enforced by commitlint);
releases are cut by release-please.

## Runtime locations

| What     | Default                         | Override           |
|----------|---------------------------------|--------------------|
| Config   | `~/.config/xuefu/config.yml`    | `XUEFU_CONFIG_DIR`, `XDG_CONFIG_HOME` |
| Data/DB  | `~/.local/share/xuefu/xuefu.db` | `XUEFU_DATA_DIR`, `XDG_DATA_HOME`     |
| Logs     | `~/.local/share/xuefu/logs/`    | (follows data dir) |

Secrets are never stored in config files. Reference them via environment variables or the OS keychain.

## License

Licensed under the [Apache License, Version 2.0](LICENSE). See [NOTICE](NOTICE) for attribution.
