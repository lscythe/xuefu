# Changelog

## 0.1.0 (2026-10-10)


### Features

* **activity:** read back what happened, in the CLI and the cockpit ([#15](https://github.com/lscythe/xuefu/issues/15)) ([74b32d1](https://github.com/lscythe/xuefu/commit/74b32d17a1f31178e025fabde7b4e252d42a80d9))
* **app:** add secret redaction with registry and pattern rules ([c609580](https://github.com/lscythe/xuefu/commit/c60958058552b51b919e9f103c7979f6056b80bf))
* **cli:** add entrypoint with version, help and diagnostics ([588e109](https://github.com/lscythe/xuefu/commit/588e109f07d15d8ae94199076a31b066a09fd68f))
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
* **notes:** a note per workspace and per issue ([#17](https://github.com/lscythe/xuefu/issues/17)) ([f326bb4](https://github.com/lscythe/xuefu/commit/f326bb451a9858de9df4a776aad1b10e27489420))
* **notes:** write and edit notes in the cockpit ([#20](https://github.com/lscythe/xuefu/issues/20)) ([a7c50cb](https://github.com/lscythe/xuefu/commit/a7c50cb3cf3cb32d2f0e3afb09a17749abab7e65))
* **shared:** add atomic file writes and path containment ([b2f6031](https://github.com/lscythe/xuefu/commit/b2f603134aea750717a0fe2a7ea99e34db3f5f89))
* **shared:** add branded ids, time values, ring buffer and event envelope ([83a2d83](https://github.com/lscythe/xuefu/commit/83a2d838fed46a9ecd1a55bc2e1cfc755d50504e))
* **shared:** add Result type and core error model ([9833338](https://github.com/lscythe/xuefu/commit/983333881d6a15b4d90b8a742c1e917405fd3510))
* **theme:** add XueFu palette with contrast and status rules ([4e1ba0a](https://github.com/lscythe/xuefu/commit/4e1ba0af4d474fdd7c3224a16dccc920a9fa7a14))
* **timesheet:** time work with a crash-safe timer ([#12](https://github.com/lscythe/xuefu/issues/12)) ([379f80e](https://github.com/lscythe/xuefu/commit/379f80e2dbb65e3aaa65ef3c56b3c3c19b29f5d9))
* **tui:** command palette ([#14](https://github.com/lscythe/xuefu/issues/14)) ([cc82698](https://github.com/lscythe/xuefu/commit/cc8269872bc8cdc82bf488dc00fb6f44c4734698))
* **tui:** keep the cockpit up to date with other terminals ([#16](https://github.com/lscythe/xuefu/issues/16)) ([185235d](https://github.com/lscythe/xuefu/commit/185235d97d48a8884af2913227dd7155858e54aa))
* **tui:** nerd font icons and centred dialogs ([#19](https://github.com/lscythe/xuefu/issues/19)) ([f44cf37](https://github.com/lscythe/xuefu/commit/f44cf37e6474817c3781e4aa04854c2064017a79))
* **tui:** open the cockpit shell ([#9](https://github.com/lscythe/xuefu/issues/9)) ([1b9e4d9](https://github.com/lscythe/xuefu/commit/1b9e4d978e9ac3a6015b2d8f3e0daefa0a28819b))
* **tui:** redesign the cockpit ([#18](https://github.com/lscythe/xuefu/issues/18)) ([1981ce9](https://github.com/lscythe/xuefu/commit/1981ce928f68924f91092f088da05882ac40fe6d))
* **tui:** switch workspaces with ctrl+w and reopen the last one ([#10](https://github.com/lscythe/xuefu/issues/10)) ([8f50b41](https://github.com/lscythe/xuefu/commit/8f50b419a87c848a3f1c8239ae5846592eb65198))
* **tui:** workspace tabs with alt+1..9 ([#11](https://github.com/lscythe/xuefu/issues/11)) ([98c488b](https://github.com/lscythe/xuefu/commit/98c488b0f1f43993b54ef4df0062414a7c774936))
* **workspace:** register and locate workspaces ([#8](https://github.com/lscythe/xuefu/issues/8)) ([1026533](https://github.com/lscythe/xuefu/commit/1026533cae06b23d4f1bd15f4ce6d0e943de2533))
* **work:** track the issue each workspace is being worked on ([#13](https://github.com/lscythe/xuefu/issues/13)) ([e2936dc](https://github.com/lscythe/xuefu/commit/e2936dc735b30707b97cfa48e51a085933a42cd6))


### Bug Fixes

* **app:** stop treating PWD as a credential ([161e694](https://github.com/lscythe/xuefu/commit/161e6945edbb2240a9e199fb9eb01b42a28f7220))
* **logging:** avoid check-then-use races in the file sink ([#6](https://github.com/lscythe/xuefu/issues/6)) ([837ac35](https://github.com/lscythe/xuefu/commit/837ac354b74cade6c8eeb2b0e25e1b439d143427))
* **shared:** preserve __proto__ keys in canonical JSON and redaction ([92050a7](https://github.com/lscythe/xuefu/commit/92050a78390aafe97bd9b65a2eed2ee1db5023f3))


### Documentation

* add README with development workflow ([4c072af](https://github.com/lscythe/xuefu/commit/4c072af1b782494335787e1b3591d6680cce9103))
* add status badges to the README ([#3](https://github.com/lscythe/xuefu/issues/3)) ([4ce25ce](https://github.com/lscythe/xuefu/commit/4ce25ce29236c0e22c9206ff879341bbd6cf49af))
* license under Apache-2.0 ([#7](https://github.com/lscythe/xuefu/issues/7)) ([29dffea](https://github.com/lscythe/xuefu/commit/29dffea7f0dc557565d9503cb9de014b4aae0463))
