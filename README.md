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
> tracks the issue you are working on and times it, works with git, and lists your Jira issues;
> the PR, Jenkins and Android plugins are not built yet.

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
xuefu jira                                                     # your open Jira issues
xuefu jira show MOB-2841                                       # one issue, with its description
xuefu diagnostics                                              # paths, config sources, database state
```

Exit codes follow sysexits: `64` usage, `65` conflict, `66` not found, `69` a tool such as git
failed or is missing, or a service such as Jira failed, `74` I/O, `77` a service refused the
credentials, `78` configuration.
`workspace which` exits `1` outside every workspace, and `work` and `timer` exit `1` when nothing
is in progress, which makes them usable in shell prompts. `activity` and `note` exit `1` when
there is nothing to show, `git` exits `1` when the workspace is not a git repository, and `jira`
exits `1` when no issue matches.
The cockpit needs an interactive terminal of at least 80×24; piped or scripted runs exit `64`.
It opens on the workspace containing the current folder, alongside the tabs you left open.

| Key            | In the cockpit                                   |
|----------------|--------------------------------------------------|
| `↑` `↓`, `j` `k` | move between sections (each workspace remembers its own) |
| `:`            | command palette: find any action by name, such as starting or finishing work |
| `Ctrl+W`       | find a workspace and open it in a tab            |
| `Alt+1`…`Alt+9` | bring that tab to the front                     |
| `Alt+W`        | close the front tab                              |
| `Tab`, `Shift+Tab` | on the dashboard: move focus between its panels; on a plugin's section such as Git: give it the keyboard, or take it back |
| `1`…`4`        | on the dashboard: focus that panel               |
| `Enter`        | on the dashboard: open the focused panel's section; on a plugin's section: give it the keyboard |
| `Esc`          | in a plugin's section: give the keyboard back to the navigation |
| `t`            | start, pause or resume the front workspace's timer (for its work in progress) |
| `Shift+T`      | stop the timer                                   |
| `e`, `i`       | in Notes: edit the workspace's note, or the note on its work in progress |
| `Space`        | in Git: stage or unstage the file under the cursor |
| `a`            | in Git: stage every change except conflicts, or unstage everything once all is staged |
| `c`            | in Git: write a commit of what is staged |
| `b`            | in Git: find a branch to switch to, create one, or delete one with `Ctrl+D` |
| `f`, `p`, `P`  | in Git: fetch, pull, or push the branch (publishing it if it has no upstream) |
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

Integrations are built-in plugins, set in `config.yml`. Git is on unless turned off; Jira is on
once it has an address. Settings for a plugin XueFu does not have are an error, so a typo does not
go unnoticed.

```yaml
version: 1
plugins:
  git:
    enabled: false     # no `xuefu git` and no Git section
    refreshSeconds: 3  # how often the Git section reads status while open (1 to 300)
  jira:
    url: https://jira.example.com
    token: { env: JIRA_TOKEN }  # or { keychain: { service: jira, account: you } }
    jql: project = MOB AND assignee = currentUser()  # optional; your open issues by default
    maxResults: 50              # how many to list (1 to 100)
    refreshSeconds: 120         # how often the Jira section reads them while open (30 to 3600)
```

| Plugin | Adds |
|--------|------|
| `git`  | `xuefu git status`, and a Git section in the cockpit: the branch, how it compares with its upstream, and changed files to stage and commit |
| `jira` | `xuefu jira issues` and `xuefu jira show <key>`, and a Jira section listing your issues, for Jira Data Center or Server |

A plugin's section sits in the cockpit's nav after Work, and is only there while the plugin is on.
The Git section reads the front workspace's status when it opens and again every few seconds while
it stays open, with the branch and how far it is ahead or behind in the panel's frame. With the
keyboard (`Tab`), the arrows pick a file and `Space` stages or unstages it. `c` opens an editor for
the commit message, where `Ctrl+S` commits; the repository's hooks run as usual, and if one
refuses, its last words are shown and the message stays. `Esc` closes the editor and keeps the
message for next time, or stops a commit still running.

`b` lists the branches here, then those on remotes that nothing here tracks; typing narrows the
list, `Enter` switches (a remote's branch gets a local branch tracking it), and a new name is offered
to create. Pulling, pushing and deleting a branch ask first, naming the branch, where it goes and
what follows; `Enter` or `y` approves. Git keeps a branch whose commits are not merged, and a second
`Ctrl+D` offers to force it: that is destructive, so only `y` approves it. An approval is bound to
the branch it named, so nothing is pushed or pulled if another branch is in front by then.

Git never prompts while the cockpit is open: a key with a passphrase must be in ssh-agent, and
HTTPS remotes need a credential helper, or the push says so instead of waiting.

Git runs as the installed `git`, with your own config, hooks and credential helpers. XueFu reads
status without taking git's index lock, so it never blocks your own git commands.

The Jira section lists what the query finds, with how many in the panel's frame, and reads it again
every couple of minutes while it stays open; if a read fails, the list last read stays, with why
above it. With the keyboard, `Enter` shows the issue under the cursor with its description, which
the arrows scroll, and `r` reads the list again.

Jira takes a personal access token (in Jira: Profile, Personal Access Tokens). `token` says where
it is kept, never the token itself: an environment variable, or the macOS keychain or a Secret
Service keyring on Linux (`security add-generic-password -s jira -a you -w` or
`secret-tool store --label Jira service jira account you`). XueFu reads it only when it first
asks Jira, never writes it to logs, and sends it only over HTTPS, unless Jira runs on this machine.

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
