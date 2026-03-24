# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **chore**: Phase 1 - version strategy foundation  ([`3cd4ba8`])
- **chore**: Phase 2 - enhance version_bump.sh  ([`f483baf`])

## [0.3.8] - 2026-03-23

### Added

- Fish completions + CLI reference for agent teams (#22) ([`0ae3776`])
- Codebase context system — R1-R4 (#23) ([`d7d020e`])

## [0.3.7] - 2026-03-23

### Added

- **tickets**: Phase 1 - add GET /api/ticket-projects endpoint (#20) ([`a774384`])
- Project-repo normalization & unified API (#21) ([`d4d484f`])

## [0.3.6] - 2026-03-22

### Fixed

- **board**: Default to all projects and auto-exclude backlog/archived ([`8a7a35b`])

## [0.3.5] - 2026-03-22

### Added

- PA-906 deploy routing API — --ticket flag + /api/deploy-routing ([`9c72179`])
- **tickets**: Phase 1 - backlog/archive core changes  ([`d8f9c1c`])
- **tickets**: Phase 2 - migrate-on-hold.sh migration script  ([`cba49c5`])
- **tickets**: Phase 3 - global skill doc updates  ([`9596eeb`])
- **skills**: Phase 4 - sprint-master triage auto-archive and suggest-backlog  ([`d1a7c5a`])
- **verify**: Phase 5 - testing verification and on-hold cleanup  ([`15dd854`])
- **standards**: Phase 1 - doc-ref enforcement documentation foundation ([`80d33a2`])
- **tickets**: Phase 2 - CLI doc-ref reminders, auto-suggest, and comment hints  ([`55f308a`])
- **standards**: Phase 3 - skill doc updates for doc-ref enforcement  ([`a428b7d`])
- **scripts**: Phase 4 - retroactive doc-ref sweep script  ([`9a29844`])

### Fixed

- **board**: Default excludeTags to backlog,archived on board API ([`9928754`])

## [0.3.4] - 2026-03-22

### Fixed

- **tickets**: Escape special chars in audit log shell command ([`0ab2f4b`])

## [0.3.3] - 2026-03-22

### Added

- **tickets**: PA-904 phase 1 - doc-ref awareness and review endpoint ([`2f907be`])
- **skills**: PA-904 phase 2 - mandate doc_ref on handoff in skill docs ([`1f3321d`])

## [0.3.2] - 2026-03-22

### Added

- **skills**: PA-878 purge deprecated output patterns and enforce one-ticket-per-work-item rule (#14) ([`5fea98f`])
- **tickets**: PA-901 - enforce team/agent-name format in comment author field ([`f5b6b4b`])
- **tickets**: PA-901 enforce team/agent-name format in comment author field (#15) ([`0e151b0`])

### Fixed

- **api**: Normalize relative paths in sandbox middleware  ([`0df261a`])

## [0.3.1] - 2026-03-22

### Added

- **kanban**: Migrate ticket system to extended kanban status vocabulary ([`59eaf7c`])
- **primer**: Add global_docs injection for team/mode-scoped skill docs ([`44b2823`])
- **skills**: Add kanban workflow docs and wire into team primers ([`a0a83af`])
- **teams**: Replace folder-based view with kanban board  ([`220aaf8`])
- **tickets**: PA-877 phase 1 - status validation, handoff warning, summary enforcement ([`2b33a3f`])
- **board**: Phase 1.5 - add pa board command with project-wide ticket view ([`8ca785f`])
- **docs**: Phase 2 - core standard docs (summary-templates, workflow-policy, kanban-workflow) ([`6ae1b0f`])
- **docs**: PA-877 phase 3 - ticket-centric workflow, kanban vocab in all skill docs ([`4be348d`])
- **tickets**: PA-877 phase 4 - migration script, AC3/AC4 fixes, validation ([`537ccdc`])
- **kanban**: Merge kanban ticket system with PA-877 improvements ([`ede31c5`])
- **tickets**: PA-894 migrate team field to assignee-only ownership (#12) ([`1efbc3b`])
- **api**: PA-890 document viewing & comments CRUD (#13) ([`2879055`])

### Changed

- **teams**: Deprecate secretary team, absorbed by sprint-master  ([`e322e0a`])

### Fixed

- **nix**: Filter node_modules/dist/.git from flake build source ([`37219d8`])

## [0.3.0] - 2026-03-21

### Added

- **serve**: Phase 1 - scaffold Hono server, pa serve command, middleware, health endpoint ([`ef057b2`])
- **serve**: Phase 2 - inbox, folders, config routes and markdown parser ([`787b8a7`])
- **serve**: Phase 3 - deployments, teams, deploy, ideas, timers, and sinh-inputs action routes ([`e67c510`])
- **serve**: Phase 4 - WebSocket support and file watchers for real-time events ([`4bbfbf8`])
- **serve**: Phase 5 - flake.nix systemd service and dev-pa-serve script ([`aee81e9`])
- **tickets**: Session 1 - ticket data model, store, board, and metrics ([`fa4c2ab`])
- **tickets**: Phase 5 - ticket CLI commands (create/update/list/show/attach/comment) ([`e60106c`])
- **tickets**: Phase 6+7 - ticket API endpoints + board view + WebSocket watcher ([`4c62b52`])
- **bulletins**: Phase 4 - bulletin board system (steps 8-13) ([`3c83ab2`])
- **sprint-master**: Phase 14 - sprint-master team YAML and skill files ([`598ce8a`])
- **standards**: Phase 16 - update global standards for ticket system ([`61499a8`])
- **skills**: Phase 15 - update agent skills to use ticket system ([`895973e`])
- **kanban**: Phase 18-20 - bulletin API, bulletin WS watcher, teams ticket stats, cleanup ([`987ce19`])

### Fixed

- **flake**: Update pnpmDeps hash and replace deprecated system attr ([`1d01050`])
- **serve**: Fix inbox/for-later single-file reads, bump to v0.2.11 ([`00a28ce`])
- **dev**: Dev-pa auto-builds before running, remove nix build dependency ([`023d1bb`])

## [0.2.10] - 2026-03-20

### Added

- **deploy**: Phase 1 - crash handling and pid tracking for foreground modes (#10) ([`ad249a4`])

## [0.2.9] - 2026-03-20

### Added

- **deploy**: Phase 1 - add early mode validation before workspace creation ([`3c9ea3e`])
- **completions**: Phase 2 - update fish completions with all missing flags and dynamic mode completion ([`205ba3e`])
- **primer**: Phase 3-6 combined - template vars, daily/requirements thin wrappers ([`021089a`])

### Fixed

- **primer**: Add solo mode flag to suppress multi-agent deployment instructions ([`fe090e6`])

## [0.2.8] - 2026-03-19

### Added

- **builder**: Add worker mode and prioritize CLI objective input ([`cc39fdd`])
- **repos**: Phase 1 - PA-side repos registry and --repo flag (#8) ([`524b393`])

### Fixed

- **builder**: Set foreground/worker modes phone_visible to false ([`c26a471`])

## [0.2.7] - 2026-03-18

### Added

- **observability**: Capture tool calls and child deploy-ids in activity log ([`4c13480`])

## [0.2.6] - 2026-03-18

### Fixed

- **status**: Broaden --report search to all teams and sinh-inputs subfolders ([`542cece`])

## [0.2.5] - 2026-03-18

### Fixed

- **status**: Search report content for deploy-id, not just filename ([`ddcf4fd`])

## [0.2.4] - 2026-03-18

### Added

- **requirements**: Add spike research mode with researcher agent (#6) ([`8f5650a`])
- **observability**: Agent activity observability for PA deployments (#7) ([`c6b47ee`])

## [0.2.3] - 2026-03-18

### Added

- **routing**: Phase 3 - secretary routed_by skip logic + integration verification ([`92bf869`])
- **status**: Phase 1 - add --wait, --report, --artifacts flags ([`15dc056`])
- **orchestrator**: Phase 2 - create teams/orchestrator.yaml ([`c7bfcd1`])
- **orchestrator**: Phase 3 - create skills/orchestrator.md ([`3cc53cf`])
- **orchestrator**: Phase 4 - create teams/orchestrator/modes/orchestration.md ([`5947f07`])
- **orchestrator**: Merge orchestrator team + pa status extensions ([`e8b78e9`])

### Documentation

- **changelog**: Update for v0.2.2 ([`8101086`])

## [0.2.2] - 2026-03-17

### Added

- **primer**: Phase 1 - split standards.md into 4 composable modules ([`5b8408b`])
- **types**: Phase 2 - add mode_type to DeployMode interface ([`32808a6`])
- **yaml-parser**: Phase 3 - parse mode_type field in deploy modes ([`7a8e438`])
- **primer**: Phase 4 - module-based standards loading via selectModules() ([`ca301a8`])
- **skills**: Phase 5 - create skills/global/housekeeping-objective.md ([`3b909e9`])
- **teams**: Phase 6 - update all 11 team YAMLs with default_mode, housekeeping mode, mode_type ([`d080c76`])
- **standards**: Phase 7 - remove old monolithic standards.md ([`f7399ac`])
- **test**: Phase 8 - verification pass + secretary routing fix ([`1fe1468`])
- **primer-pipeline**: Mode-aware standards modularization ([`86b5cc0`])
- **knowledge-hub**: Add spike learning session mode ([`7c08220`])

## [0.2.1] - 2026-03-17

### Added

- **teams,yaml**: Phase 1 - add model fields to team YAMLs + MODEL column in pa teams ([`83f5682`])
- Team YAML mode restructure — mode-specific primers & config-driven capabilities ([`f6724a6`])
- **requirements**: Phase 1 - review mode YAML entry + orchestrator skill ([`f3c0643`])
- **requirements**: Phase 2 - area skills (code-quality, security, ops, ui-uat) ([`6af84c1`])
- **requirements**: Phase 3 - test verification + review-objective fix ([`5583867`])

### Documentation

- Update CHANGELOG for v0.1.20 ([`58870ca`])

## [0.1.20] - 2026-03-17

### Added

- **idea,report**: Fix double-input bug + add pa report command ([`3c98435`])

### Documentation

- Update CHANGELOG for v0.1.16–0.1.19 ([`bbb04f1`])

## [0.1.18] - 2026-03-17

### Added

- **teams**: Richer pa teams <name> output — slug + date/from/to per item ([`7e374d5`])

## [0.1.17] - 2026-03-17

### Added

- **requirements**: Phase 1 - add triage-ideas skill for automated ideas pipeline ([`66af81d`])
- **requirements**: Phase 2 - add ideas deploy mode to requirements.yaml ([`1b79fcf`])
- **requirements**: Phase 3 - create requirements.ts command handler ([`97f35ad`])
- **requirements**: Phase 4 - register requirements command in cli.ts ([`347413d`])
- **requirements**: Phase 5 - add requirements spec parsing to schedule.ts ([`fd62d26`])
- **requirements**: Ideas triage deploy mode — all 5 phases ([`3537641`])

## [0.1.16] - 2026-03-16

### Added

- **secretary**: Phase 1 - add direct deploy mode to secretary.yaml ([`818053c`])
- **secretary**: Phase 2 - add --direct CLI flag and deploy mode detection ([`e0b92b2`])
- **secretary**: Phase 3 - direct mode section, extended Phase 4 actions, ongoing count ([`62828bd`])

### Documentation

- Update CHANGELOG for v0.1.15 (deploy context injection + multi-phase completion fix) ([`b442ae6`])

## [0.1.15] - 2026-03-16

### Added

- **deploy**: Inject cwd and repo_root into deployment-context primer ([`048edaa`])

### Fixed

- **builder**: Enforce ongoing/ and checklist-based completion for multi-phase items ([`05ba91d`])

## [0.1.14] - 2026-03-16

### Added

- **workflow**: Enforce inbox → ongoing across all teams (#3) ([`c803442`])

## [0.1.13] - 2026-03-16

### Added

- **teams**: Add workflow status to pa teams command ([`25f9674`])

## [0.1.12] - 2026-03-16

### Added

- **rpm**: Phase 1 - RPM block foundation (team yaml + interactive manage skill) ([`8a182ec`])
- **rpm**: Phase 2 - daily plan integration (RPM context + task labeling) ([`e9772e4`])
- **rpm**: Phase 3 - weekly review (gather skill + review skill + rpm-gather team) ([`dcc8db6`])
- **rpm**: Merge RPM personal planning system (phases 1-3) ([`c25a5a3`])

### Documentation

- Update CHANGELOG for v0.1.12 (RPM personal planning system) ([`1dafe82`])

## [0.1.11] - 2026-03-16

### Added

- **skills**: Improve daily-summary and requirements skills ([`7791824`])

### Documentation

- Journal house-chores run for 2026-03-15 ([`ad2b1da`])

### Fixed

- **deploy**: Fix JSON quoting in crash registry writer ([`b85f712`])

## [0.1.9] - 2026-03-15

### Added

- **builder**: Phase 1 - add deploy_modes to all 9 team YAMLs (#2) ([`5e04c1a`])

### Documentation

- Update CHANGELOG for v0.1.8 (and backfill 0.1.6, 0.1.7) ([`1148f5c`])

## [0.1.8] - 2026-03-15

### Added

- **builder**: Phase 1 - update standards.md templates + Routing Fields guidance ([`b8391d0`])
- **builder**: Phase 2 - update analyze.md Output section with explicit From:/To: fields ([`f59af45`])
- **deploy**: Phase 3 - add --route-decisions flag injecting mode into primer ([`ba37d23`])
- **builder**: Phase 4 - add Route-Decisions Mode to secretary.yaml (Phases R1-R6) ([`9966e3d`])
- **builder**: Phase 5 - add pending-route/ count to secretary Phase 3 briefing ([`a0dbc64`])
- Secretary route-decisions mode (phases 1-5) ([`ca3d45e`])

## [0.1.7] - 2026-03-15

### Added

- **builder**: Phase 1 - add ongoing/ folder and claim/release protocol to standards ([`8d575f8`])
- **builder**: Phase 3 - secretary stale ongoing detection ([`540aa88`])
- Merge ongoing-status agent-team workflow (phases 1+3) ([`a69ba2c`])

## [0.1.6] - 2026-03-14

### Added

- **lean-queue**: Phase 1 - add WFR self-resolution to standards.md startup sequence ([`6a4e09c`])
- **lean-queue**: Phase 2 - update WORKFLOW.md with WFR self-resolution lifecycle ([`59c72c5`])
- **lean-queue**: Phase 3 - publish human workflow guide ([`5bdda21`])
- **lean-queue**: Phase 4 - add approve/reject/defer #N commands to secretary ([`8c5a718`])
- **lean-queue**: Phase 5 - update secretary collect.md with daily board, project tracking, orphan cleanup ([`18df6e2`])
- **lean-queue**: Phase 6 - add secretary trigger to daily-end objective ([`ef071c9`])
- **model-selection**: Add --team-model and --agent-model CLI flags with model resolution (#1) ([`8731abf`])

### Documentation

- Update CHANGELOG for v0.1.5 ([`ae913c2`])

### Fixed

- Read version from package.json at runtime (was hardcoded 0.1.2) ([`ca752b2`])
- Inject version at build time via tsup define (no runtime file lookup) ([`b02a69b`])

## [0.1.5] - 2026-03-14

### Added

- Split daily end into two phases + add plan review mode ([`cf45169`])
- Refactor secretary into multi-agent team with evidence-based auditing ([`87a6624`])
- **builder**: Phase 1 - create knowledge-hub team YAML ([`0a04b96`])
- **builder**: Phase 2 - create knowledge-hub gather skill ([`5be6f3f`])
- **builder**: Phase 3 - create knowledge-hub curate skill ([`61c5c90`])
- **builder**: Phase 4 - create knowledge-hub facilitate skill ([`e210657`])
- **builder**: Phase 5 - create knowledge-hub analyze skill ([`fa777f1`])
- **builder**: Phase 6 - migrate youtube-processor to knowledge-hub ([`c8d540c`])
- **builder**: Phase 7 - seed knowledge-hub config with placeholder feeds ([`63263d2`])
- **builder**: Phase 8 - test autonomous run verification ([`527897a`])
- **builder**: Phase 7 - add Type field to all 4 authoring templates in standards.md ([`c05f3d3`])
- **builder**: Multi-repo support with pre-flight branch checks ([`c72f044`])
- **secretary**: Phase 1 - conversational interactive mode ([`87cd565`])

### Fixed

- Use YAML name field as canonical team name in deploy ([`461d3a8`])

## [0.1.2] - 2026-03-12

### Added

- Add global standards and agent skills ([`561a919`])
- Add team definitions ([`090be57`])
- Add --help to deploy.sh and pa teams command ([`6d1c1f5`])
- Add PA_CONFIG layered config for user overrides ([`944cef4`])
- Daily plan draft mode with user notes input, fix status sort ([`f6c7c8c`])
- Add --objective flag to deploy.sh and secretary agent ([`37a887d`])
- Agent work reports to for-sinh-review, secretary as pure router ([`3bcc621`])
- Add maintenance agent for system self-repair and health checks ([`f9b53d5`])
- Replace PA_CONFIG env var with hardcoded config file ([`9a4dc2f`])
- Add pa idea command for interactive idea logging ([`ec00b22`])
- Add inbox check and avo plan scheduling to daily plan ([`3955d88`])
- **migration**: Phase 1 - project scaffolding ([`29a95e3`])
- **migration**: Phase 2 - simple commands (timers, remove-timer, idea) ([`c14f2ac`])
- **migration**: Phase 3 - medium commands (status, schedule) ([`d3fa9ef`])
- **migration**: Phase 4 - complex commands (deploy, daily, primer) ([`12de193`])
- **migration**: Phase 5 - cleanup and finalize ([`1b65900`])
- Add builder team and direnv devshell ([`d166de2`])
- Migrate personal-assistant CLI from bash to TypeScript ([`ee7e168`])
- Deploy defaults to foreground, add --background flag, fix timer services ([`930e356`])
- Standardize agent output workflow and migrate to sinh-inputs/inbox ([`929acf6`])
- Add fish shell autocompletion for pa CLI ([`a02704c`])

### Documentation

- Add project identity, readme, and genesis journal ([`e3d33b5`])
- Journal house-chores run for 2026-03-11 ([`f51560a`])
- Add inbox communication workflow to global agent standards ([`07f7607`])
- Journal house-chores run for 2026-03-12 ([`0277194`])
- Add project documentation and update README ([`25669c2`])

### Fixed

- Ignore settings.local.json and add suggestions field to journal template ([`f5011db`])
- Maintenance agent defers folder structure to secretary ([`78ffd2e`])
- Escape unquoted string in daily.sh plan objective ([`02108b8`])
- Add KillMode=process to systemd services to prevent cgroup cleanup killing background deployments ([`e4ef309`])

[`0.3.8...HEAD`]: https://github.com/sinh-x/personal-assistant/compare/v0.3.8...HEAD
[`0.3.7...0.3.8`]: https://github.com/sinh-x/personal-assistant/compare/v0.3.7...v0.3.8
[`0.3.6...0.3.7`]: https://github.com/sinh-x/personal-assistant/compare/v0.3.6...v0.3.7
[`0.3.5...0.3.6`]: https://github.com/sinh-x/personal-assistant/compare/v0.3.5...v0.3.6
[`0.3.4...0.3.5`]: https://github.com/sinh-x/personal-assistant/compare/v0.3.4...v0.3.5
[`0.3.3...0.3.4`]: https://github.com/sinh-x/personal-assistant/compare/v0.3.3...v0.3.4
[`0.3.2...0.3.3`]: https://github.com/sinh-x/personal-assistant/compare/v0.3.2...v0.3.3
[`0.3.1...0.3.2`]: https://github.com/sinh-x/personal-assistant/compare/v0.3.1...v0.3.2
[`0.3.0...0.3.1`]: https://github.com/sinh-x/personal-assistant/compare/v0.3.0...v0.3.1
[`0.2.10...0.3.0`]: https://github.com/sinh-x/personal-assistant/compare/v0.2.10...v0.3.0
[`0.2.9...0.2.10`]: https://github.com/sinh-x/personal-assistant/compare/v0.2.9...v0.2.10
[`0.2.8...0.2.9`]: https://github.com/sinh-x/personal-assistant/compare/v0.2.8...v0.2.9
[`0.2.7...0.2.8`]: https://github.com/sinh-x/personal-assistant/compare/v0.2.7...v0.2.8
[`0.2.6...0.2.7`]: https://github.com/sinh-x/personal-assistant/compare/v0.2.6...v0.2.7
[`0.2.5...0.2.6`]: https://github.com/sinh-x/personal-assistant/compare/v0.2.5...v0.2.6
[`0.2.4...0.2.5`]: https://github.com/sinh-x/personal-assistant/compare/v0.2.4...v0.2.5
[`0.2.3...0.2.4`]: https://github.com/sinh-x/personal-assistant/compare/v0.2.3...v0.2.4
[`0.2.2...0.2.3`]: https://github.com/sinh-x/personal-assistant/compare/v0.2.2...v0.2.3
[`0.2.1...0.2.2`]: https://github.com/sinh-x/personal-assistant/compare/v0.2.1...v0.2.2
[`0.1.20...0.2.1`]: https://github.com/sinh-x/personal-assistant/compare/v0.1.20...v0.2.1
[`0.1.19...0.1.20`]: https://github.com/sinh-x/personal-assistant/compare/v0.1.19...v0.1.20
[`0.1.17...0.1.18`]: https://github.com/sinh-x/personal-assistant/compare/v0.1.17...v0.1.18
[`0.1.16...0.1.17`]: https://github.com/sinh-x/personal-assistant/compare/v0.1.16...v0.1.17
[`0.1.15...0.1.16`]: https://github.com/sinh-x/personal-assistant/compare/v0.1.15...v0.1.16
[`0.1.14...0.1.15`]: https://github.com/sinh-x/personal-assistant/compare/v0.1.14...v0.1.15
[`0.1.13...0.1.14`]: https://github.com/sinh-x/personal-assistant/compare/v0.1.13...v0.1.14
[`0.1.12...0.1.13`]: https://github.com/sinh-x/personal-assistant/compare/v0.1.12...v0.1.13
[`0.1.11...0.1.12`]: https://github.com/sinh-x/personal-assistant/compare/v0.1.11...v0.1.12
[`0.1.10...0.1.11`]: https://github.com/sinh-x/personal-assistant/compare/v0.1.10...v0.1.11
[`0.1.8...0.1.9`]: https://github.com/sinh-x/personal-assistant/compare/v0.1.8...v0.1.9
[`0.1.7...0.1.8`]: https://github.com/sinh-x/personal-assistant/compare/v0.1.7...v0.1.8
[`0.1.6...0.1.7`]: https://github.com/sinh-x/personal-assistant/compare/v0.1.6...v0.1.7
[`0.1.5...0.1.6`]: https://github.com/sinh-x/personal-assistant/compare/v0.1.5...v0.1.6
[`0.1.2...0.1.5`]: https://github.com/sinh-x/personal-assistant/compare/v0.1.2...v0.1.5

