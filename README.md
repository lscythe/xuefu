# 血符 XueFu

A terminal-native developer cockpit: Jira, git, pull requests, CI, Android tooling and timesheets
around a single **Work Context**.

> Status: **early development.** The terminal UI is not available yet.

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
