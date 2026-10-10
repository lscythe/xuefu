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

> Status: **early development.** The cockpit opens, switches workspaces, keeps them in tabs,
> tracks the issue you are working on and times it, and reads git status; the Jira, PR, Jenkins
> and Android plugins are not built yet.

## Usage

```bash
xuefu                                                          # open the cockpit
xuefu workspace add ~/work/mobile-banking --group "Client A"  # register a project folder
xuefu workspace                                                # list workspaces and detected tools
xuefu workspace which                                          # the workspace containing this folder
xuefu workspace remove mobile-banking --yes                    # stop tracking it; the folder is kept
xuefu work start MOB-2841 --title "Add biometric login"        # work on an issue here and time it
xuefu work                                                     # work in progress in every workspace
xuefu work finish                                              # finish it and stop its timer
xuefu timer start --issue MOB-2841                             # time this workspace (stops any other timer)
xuefu timer                                                    # the running or paused timer
xuefu timer pause | resume | stop                              # pause, resume or stop it
xuefu note append "Staging needs the VPN"                      # add a line to this workspace's note
xuefu note --issue MOB-2841                                    # print the note on an issue
pbpaste | xuefu note save                                      # replace the note (blank text clears it)
xuefu note list                                                # every note with its first line
xuefu activity -w mobile-banking -n 50                         # what happened there, newest first
xuefu git                                                      # branch and changed files here
xuefu diagnostics                                              # paths, config sources, database state
```

Exit codes follow sysexits: `64` usage, `65` conflict, `66` not found, `69` a tool such as git
failed or is missing, `74` I/O, `78` configuration.
`workspace which` exits `1` outside every workspace, and `work` and `timer` exit `1` when nothing
is in progress, which makes them usable in shell prompts. `activity` and `note` exit `1` when
there is nothing to show, and `git` exits `1` when the workspace is not a git repository.
The cockpit needs an interactive terminal of at least 80×24; piped or scripted runs exit `64`.
It opens on the workspace containing the current folder, alongside the tabs you left open.

| Key            | In the cockpit                                   |
|----------------|--------------------------------------------------|
| `↑` `↓`, `j` `k` | move between sections (each workspace remembers its own) |
| `:`            | command palette: find any action by name, such as starting or finishing work |
| `Ctrl+W`       | find a workspace and open it in a tab            |
| `Alt+1`…`Alt+9` | bring that tab to the front                     |
| `Alt+W`        | close the front tab                              |
| `Tab`, `Shift+Tab` | on the dashboard: move focus between its panels |
| `1`…`4`        | on the dashboard: focus that panel               |
| `Enter`        | on the dashboard: open the focused panel's section |
| `t`            | start, pause or resume the front workspace's timer (for its work in progress) |
| `Shift+T`      | stop the timer                                   |
| `e`, `i`       | in Notes: edit the workspace's note, or the note on its work in progress |
| `q`, `Ctrl+C`  | quit                                             |

Each workspace has at most one piece of work in progress; starting another issue there finishes
the old one. Only one timer runs at a time: starting work or a timer in another workspace stops
the current timer first, while that workspace's work stays in progress. Timers are saved as they
change, so they keep counting across restarts and crashes.

Changes to workspaces, work and timers are recorded as they happen. The Activity section shows
them for the workspace in front, newest first under a heading for each day (every workspace's
when none is open). `xuefu activity` prints the same timeline.

Each workspace has a note of its own and one per issue. The Notes section shows the workspace's
note and the note on its work in progress; `e` and `i` open them in an editor (also from the
palette), where `Ctrl+S` saves and `Esc` closes. Unsaved text is never lost to one key: `Esc` or
`Ctrl+C` asks first, and saving blank text clears the note. Notes are stored unencrypted: saving one
that looks like it holds a token or password warns you, and anything shaped like a credential is
masked wherever XueFu shows it, except in the editor, which shows the note as written.

The cockpit keeps up with commands run in other terminals: start work or a timer from the CLI and
the header, the Work section and Activity update within a second, without reopening.

On macOS, Alt shortcuts need the terminal to send Option as Meta (Terminal: Settings, Profiles,
Keyboard, "Use Option as Meta key"; iTerm2: Profiles, Keys, Left Option key "Esc+").

## Plugins

Integrations are built-in plugins, each on unless turned off in `config.yml`. Settings for a
plugin XueFu does not have are an error, so a typo does not go unnoticed.

```yaml
version: 1
plugins:
  git:
    enabled: false     # no `xuefu git` and no Git section
    refreshSeconds: 3  # how often the Git section reads status while open (1 to 300)
```

| Plugin | Adds |
|--------|------|
| `git`  | `xuefu git status`, and a Git section in the cockpit: the branch, how it compares with its upstream, and changed files |

A plugin's section sits in the cockpit's nav after Work, and is only there while the plugin is on.
The Git section reads the front workspace's status when it opens and again every few seconds while
it stays open, with the branch and how far it is ahead or behind in the panel's frame.

Git runs as the installed `git`, with your own config, hooks and credential helpers. XueFu reads
status without taking git's index lock, so it never blocks your own git commands.

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
| `bun run screenshots`   | regenerate TUI golden screenshots, render PNGs  |
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
