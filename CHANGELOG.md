# Changelog

## 1.0.0 (2026-10-13)


### Features

* **activity:** read back what happened, in the CLI and the cockpit ([#15](https://github.com/lscythe/xuefu/issues/15)) ([74b32d1](https://github.com/lscythe/xuefu/commit/74b32d17a1f31178e025fabde7b4e252d42a80d9))
* **app:** add secret redaction with registry and pattern rules ([c609580](https://github.com/lscythe/xuefu/commit/c60958058552b51b919e9f103c7979f6056b80bf))
* **app:** configure review voice and agent guidance per workspace ([#45](https://github.com/lscythe/xuefu/issues/45)) ([b1e9745](https://github.com/lscythe/xuefu/commit/b1e97454c5190faee428301c28f5faca9779dcb1))
* **app:** have claude know the workspace before it answers ([#31](https://github.com/lscythe/xuefu/issues/31)) ([3bfe4b7](https://github.com/lscythe/xuefu/commit/3bfe4b7367ee3bee8e3b3bbd2a0898e80001e221))
* ask claude from the cockpit, approving each change in xuefu ([#30](https://github.com/lscythe/xuefu/issues/30)) ([de55005](https://github.com/lscythe/xuefu/commit/de55005ae4931516f153c307efcdfd625d0ce690))
* choose the agent and its model, and ask OpenCode too ([#40](https://github.com/lscythe/xuefu/issues/40)) ([6fdd967](https://github.com/lscythe/xuefu/commit/6fdd96794156a064c2fd361a057797896eba7cd4))
* **cli:** add entrypoint with version, help and diagnostics ([588e109](https://github.com/lscythe/xuefu/commit/588e109f07d15d8ae94199076a31b066a09fd68f))
* **cli:** serve xuefu's commands to ai agents over mcp ([#29](https://github.com/lscythe/xuefu/issues/29)) ([3b0767e](https://github.com/lscythe/xuefu/commit/3b0767efd7b153ffd2321d5f95fc6cb8b5196828))
* **commands:** add command bus with confirmation gate ([cfaf0c9](https://github.com/lscythe/xuefu/commit/cfaf0c9b3554074e2952f48b851b7c4a22bc310b))
* **config:** add layered configuration with actionable validation ([e381b4b](https://github.com/lscythe/xuefu/commit/e381b4b88ddc1740f3e217c69c5550b586fa07ee))
* **db:** add activity ledger and transactional unit of work ([5a77908](https://github.com/lscythe/xuefu/commit/5a77908836bd4cdd8c5f4db29aa2dcd0b346f8fc))
* **db:** add SQLite database and checksummed migrations ([5ea5dcf](https://github.com/lscythe/xuefu/commit/5ea5dcf2d9f9e564fc47fab67f7922d17c915200))
* **events:** add event bus, event catalog and canonical JSON ([252f1ba](https://github.com/lscythe/xuefu/commit/252f1ba7b5e067c86ee20622e22313579ef12c25))
* **git:** branches, push and pull, with confirmations ([#23](https://github.com/lscythe/xuefu/issues/23)) ([b4e69de](https://github.com/lscythe/xuefu/commit/b4e69de35d763d751bd522886fee547cc47b4293))
* **git:** plugins, with git status in the CLI and cockpit ([#21](https://github.com/lscythe/xuefu/issues/21)) ([d663b3a](https://github.com/lscythe/xuefu/commit/d663b3a789963d9af43692ecc614b39d04a56efc))
* **git:** stage and commit from the cockpit ([#22](https://github.com/lscythe/xuefu/issues/22)) ([6acfc4d](https://github.com/lscythe/xuefu/commit/6acfc4d4c997a1c1cd84e4ee3388d91c9b25b46e))
* **jira:** start work from an issue ([#25](https://github.com/lscythe/xuefu/issues/25)) ([ac80d4b](https://github.com/lscythe/xuefu/commit/ac80d4b2c0bb99c43b6e47397f062416dbe5e856))
* **jira:** your jira issues in the cli and the cockpit ([#24](https://github.com/lscythe/xuefu/issues/24)) ([4587fd2](https://github.com/lscythe/xuefu/commit/4587fd203ee9c8c865280fb1b8812bef8a1c7b02))
* **logging:** add structured logger with redaction and bounded sinks ([923725a](https://github.com/lscythe/xuefu/commit/923725a67cd01ff6c9eaacee2b2b781d4dc4da66))
* manage workspaces from the cockpit, and rename them ([#35](https://github.com/lscythe/xuefu/issues/35)) ([f48e30c](https://github.com/lscythe/xuefu/commit/f48e30c678ad3104b57c1cd475de291bac7cd5ad))
* **notes:** a note per workspace and per issue ([#17](https://github.com/lscythe/xuefu/issues/17)) ([f326bb4](https://github.com/lscythe/xuefu/commit/f326bb451a9858de9df4a776aad1b10e27489420))
* **notes:** write and edit notes in the cockpit ([#20](https://github.com/lscythe/xuefu/issues/20)) ([a7c50cb](https://github.com/lscythe/xuefu/commit/a7c50cb3cf3cb32d2f0e3afb09a17749abab7e65))
* **pr:** approve, ask for changes on, and merge pull requests ([#27](https://github.com/lscythe/xuefu/issues/27)) ([7c9418d](https://github.com/lscythe/xuefu/commit/7c9418d2fad9ba1e3aa3dfc35ebd0e566b7b0eea))
* **pr:** review a pull request on its own branch ([#36](https://github.com/lscythe/xuefu/issues/36)) ([f50940a](https://github.com/lscythe/xuefu/commit/f50940aa9d7e4cd5fee7696a56df8a688ac49ea7))
* **pr:** review a pull request with claude, then post it as one ([#32](https://github.com/lscythe/xuefu/issues/32)) ([eea4ae0](https://github.com/lscythe/xuefu/commit/eea4ae00d440d0dbbb20cbbe2b44b92e6e5a7cda))
* **pr:** review pull requests fully in the terminal ([#28](https://github.com/lscythe/xuefu/issues/28)) ([b256b42](https://github.com/lscythe/xuefu/commit/b256b42e7575d6c4b6541cc2eee9b14757e0b230))
* **pr:** search and filter pull requests and flag outdated reviews ([#47](https://github.com/lscythe/xuefu/issues/47)) ([dc83e2b](https://github.com/lscythe/xuefu/commit/dc83e2b998d450f98a2698ea5cb46d1710970745))
* **pr:** show authors in the list and render Markdown details ([#46](https://github.com/lscythe/xuefu/issues/46)) ([b2d3429](https://github.com/lscythe/xuefu/commit/b2d34294f78019b1e1feb1afaa2790fbd4074573))
* **pr:** your bitbucket pull requests in the cli and the cockpit ([#26](https://github.com/lscythe/xuefu/issues/26)) ([a71953b](https://github.com/lscythe/xuefu/commit/a71953bca793641970fbaee5fce321a1ae12a8d1))
* **shared:** add atomic file writes and path containment ([b2f6031](https://github.com/lscythe/xuefu/commit/b2f603134aea750717a0fe2a7ea99e34db3f5f89))
* **shared:** add branded ids, time values, ring buffer and event envelope ([83a2d83](https://github.com/lscythe/xuefu/commit/83a2d838fed46a9ecd1a55bc2e1cfc755d50504e))
* **shared:** add Result type and core error model ([9833338](https://github.com/lscythe/xuefu/commit/983333881d6a15b4d90b8a742c1e917405fd3510))
* show the agent's thinking, a clearer conversation, and ask the agent generally ([#42](https://github.com/lscythe/xuefu/issues/42)) ([f177df0](https://github.com/lscythe/xuefu/commit/f177df05ea7d08b8298668b520f8d1d80676ef21))
* **theme:** add XueFu palette with contrast and status rules ([4e1ba0a](https://github.com/lscythe/xuefu/commit/4e1ba0af4d474fdd7c3224a16dccc920a9fa7a14))
* **timesheet:** time work with a crash-safe timer ([#12](https://github.com/lscythe/xuefu/issues/12)) ([379f80e](https://github.com/lscythe/xuefu/commit/379f80e2dbb65e3aaa65ef3c56b3c3c19b29f5d9))
* **tui:** command palette ([#14](https://github.com/lscythe/xuefu/issues/14)) ([cc82698](https://github.com/lscythe/xuefu/commit/cc8269872bc8cdc82bf488dc00fb6f44c4734698))
* **tui:** keep the cockpit up to date with other terminals ([#16](https://github.com/lscythe/xuefu/issues/16)) ([185235d](https://github.com/lscythe/xuefu/commit/185235d97d48a8884af2913227dd7155858e54aa))
* **tui:** nerd font icons and centred dialogs ([#19](https://github.com/lscythe/xuefu/issues/19)) ([f44cf37](https://github.com/lscythe/xuefu/commit/f44cf37e6474817c3781e4aa04854c2064017a79))
* **tui:** open the cockpit shell ([#9](https://github.com/lscythe/xuefu/issues/9)) ([1b9e4d9](https://github.com/lscythe/xuefu/commit/1b9e4d978e9ac3a6015b2d8f3e0daefa0a28819b))
* **tui:** redesign the cockpit ([#18](https://github.com/lscythe/xuefu/issues/18)) ([1981ce9](https://github.com/lscythe/xuefu/commit/1981ce928f68924f91092f088da05882ac40fe6d))
* **tui:** start work with s, from the Work panel or the dashboard ([#39](https://github.com/lscythe/xuefu/issues/39)) ([12f431e](https://github.com/lscythe/xuefu/commit/12f431e2790d6592a9386009444311a02a88e182))
* **tui:** switch workspaces with ctrl+w and reopen the last one ([#10](https://github.com/lscythe/xuefu/issues/10)) ([8f50b41](https://github.com/lscythe/xuefu/commit/8f50b419a87c848a3f1c8239ae5846592eb65198))
* **tui:** workspace tabs with alt+1..9 ([#11](https://github.com/lscythe/xuefu/issues/11)) ([98c488b](https://github.com/lscythe/xuefu/commit/98c488b0f1f43993b54ef4df0062414a7c774936))
* **workspace:** register and locate workspaces ([#8](https://github.com/lscythe/xuefu/issues/8)) ([1026533](https://github.com/lscythe/xuefu/commit/1026533cae06b23d4f1bd15f4ce6d0e943de2533))
* **work:** track the issue each workspace is being worked on ([#13](https://github.com/lscythe/xuefu/issues/13)) ([e2936dc](https://github.com/lscythe/xuefu/commit/e2936dc735b30707b97cfa48e51a085933a42cd6))


### Bug Fixes

* **activity:** leave opening a workspace out of the activity ([#38](https://github.com/lscythe/xuefu/issues/38)) ([f6d528d](https://github.com/lscythe/xuefu/commit/f6d528dd3a5daed96a49ba4368f5a5a1027c6b2c))
* **app:** stop treating PWD as a credential ([161e694](https://github.com/lscythe/xuefu/commit/161e6945edbb2240a9e199fb9eb01b42a28f7220))
* **logging:** avoid check-then-use races in the file sink ([#6](https://github.com/lscythe/xuefu/issues/6)) ([837ac35](https://github.com/lscythe/xuefu/commit/837ac354b74cade6c8eeb2b0e25e1b439d143427))
* place a review's comments on the diff before asking to post them ([#43](https://github.com/lscythe/xuefu/issues/43)) ([e7fa30a](https://github.com/lscythe/xuefu/commit/e7fa30a5166d64234342814889d457d36fc7504e))
* post review comments on the diff's lines, and show posting as it goes ([#44](https://github.com/lscythe/xuefu/issues/44)) ([2a32557](https://github.com/lscythe/xuefu/commit/2a325572323e6f81a32d4c863d5bd3fe8a824229))
* **pr:** ask Bitbucket for a pull request's diff as text ([#41](https://github.com/lscythe/xuefu/issues/41)) ([45fe156](https://github.com/lscythe/xuefu/commit/45fe1567577582921e7d3077dea485803625d323))
* **shared:** preserve __proto__ keys in canonical JSON and redaction ([92050a7](https://github.com/lscythe/xuefu/commit/92050a78390aafe97bd9b65a2eed2ee1db5023f3))
* **tui:** give pull requests and issues room to be read ([#34](https://github.com/lscythe/xuefu/issues/34)) ([ad4637f](https://github.com/lscythe/xuefu/commit/ad4637f66bf26a77cfd341da213d18fcc317e9de))
* **tui:** wait for a plugin's section to load instead of crashing ([#33](https://github.com/lscythe/xuefu/issues/33)) ([d610b3c](https://github.com/lscythe/xuefu/commit/d610b3ce8eee36cea0918b0dca80f938efbb4618))


### Documentation

* add README with development workflow ([4c072af](https://github.com/lscythe/xuefu/commit/4c072af1b782494335787e1b3591d6680cce9103))
* add status badges to the README ([#3](https://github.com/lscythe/xuefu/issues/3)) ([4ce25ce](https://github.com/lscythe/xuefu/commit/4ce25ce29236c0e22c9206ff879341bbd6cf49af))
* license under Apache-2.0 ([#7](https://github.com/lscythe/xuefu/issues/7)) ([29dffea](https://github.com/lscythe/xuefu/commit/29dffea7f0dc557565d9503cb9de014b4aae0463))
