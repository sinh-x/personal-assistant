# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.4.7] - 2026-04-23

### Added

- **board**: Phase 1 - add resolveProjectFromCwd() helper to repos.ts ([`caa92d7`])
- **board**: Phase 2 - add --all flag and CWD detection logic ([`62ce163`])
- **board**: Phase 3-5 - complete CWD-aware defaults, skill updates, testing ([`05ad80c`])
- **deploy**: Per-mode provider override and builder minimax defaults ([`a7adab9`])
- **tickets**: Phase 1 - doc_ref deduplication upsert logic ([`1dab180`])
- **tickets**: Phase 2 - doc_ref dedup cleanup script and verification ([`7698ea3`])
- **registry**: PA-1005 enrich deployment registry + API with objective, repo, and fix minimax models gap ([`ad1a1cb`])
- **builder**: PA-993 Phase 1 - deploy CLI docs and --direct validation (#34) ([`819aec0`])
- **store**: Phase 1 - add normalizeTicket() to store.ts ([`d558e79`])
- **builder**: Enrich orchestrator objective with requirements, NFRs, AC, and test coverage ([`608781d`])
- **builder**: Phase 2 - add migrate_blockedby script for PA-988 ([`01dedbf`])
- **builder**: Migrate implement/worker/orchestrator from inbox to ticket-based workflow ([`67d065f`])
- **self-improvement**: Phase 1 - foundation for PA-935 ([`3e763a0`])
- **self-improvement**: Phase 2 - update maintenance skill and daily-end integration ([`643bfda`])
- **self-improvement**: Phase 3 - primer injection and knowledge-base files ([`820dd13`])
- **self-improvement**: Phase 5 - KPI integration ([`5a10c5e`])
- **pa-cli-ux**: Phase 1 - fish completions, deprecated flags, error handling, validation, help text ([`724fc81`])
- **pa-cli-ux**: Phase 2 - add validation test script for fish completions ([`9472f67`])
- **builder**: Add requirements doc gate to orchestrator workflow ([`3e035e0`])
- **builder**: Change orchestrator mode_type from interactive to work ([`936927e`])
- **builder**: Add PATH fallback for pa bin lookup ([`99a53e1`])
- **pa**: Default all teams to MiniMax provider + archive unused teams ([`53131c3`])
- **skills**: Add UAT doc generation + separate branch management concerns  ([`2bb0a75`])
- **deploy**: Inject ticket context into primer and add alignment checks  ([`816434b`])
- **cli**: Fix fish completions for ticket key + widen assignee column  ([`6398834`])
- **daily**: Set end-review mode to use anthropic opus model ([`d0feab6`])
- **daily**: Align plan-review mode with end-review (anthropic/opus) ([`27a55ae`])
- **api**: Phase 1 - git repo info API endpoints ([`e6cc35c`])
- **serve**: Add stop/restart/status subcommands and PID management  ([`4b80b4a`])
- **api**: Git repo info API + serve management  ([`7ebdac2`])
- **requirements**: Add review-auto mode  ([`78bcacc`])
- **api**: Repo deployment API + review fixes (PA-1058, PA-1065) (#43) ([`6c80100`])
- **deploy**: Fail fast on non-existent ticket before workspace creation (#44) ([`950c4df`])
- **api**: Add POST /api/tickets/:id/attachments/upload endpoint  ([`3d0368f`])
- **doc-ref**: Phase 1 - write-time validation + check-refs audit command ([`b649269`])
- **ticket-move**: Phase 1 - types + core store logic  ([`a54cffb`])
- **ticket-move**: Phase 2 - CLI move command + show alias notice  ([`d27dbeb`])
- **ticket-move**: Phase 3 - API route for ticket move ([`c962fec`])
- **api**: Phases 1-3 - add date filtering to deployment list endpoints (#47) ([`7d70757`])
- Routine session scanning & provider comparison (#48) ([`9b7e0da`])
- **builder**: Add routine deploy mode for phone-triggered ticket cleanup (#51) ([`d62ec68`])
- **builder**: Phase 1 - extend activity-log.sh with new hook handlers ([`ef4c9f3`])
- **builder**: Phase 2 - update formatActivityLine for new event types ([`c155967`])
- **builder**: B-007 phase 1 - normalizeTicket null handling + formatRow defensive checks ([`060faa7`])
- **deploy**: B-004 bgScript shell-safety — env vars + temp file ([`9fe52c6`])
- PA CLI robustness — shell safety, null handling, spike validation ([`190ae01`])
- Phase 1 - respect per-repo mainBranch/developBranch config (#53) ([`89fbcb7`])
- **builder**: Phase 1 - add resolveGhRepo() and extend standardVars with repo-aware template variables ([`536a8b4`])
- **builder**: Phase 2 - deploy.ts repo wiring and --repo-all loop ([`8a3ef47`])
- **builder**: Phase 3 - update routine.md with repo-aware template variables ([`7dfb50a`])
- **repos**: Add "none" sentinel for developBranch config  ([`eb5b358`])
- **gtd-focus**: GTD Focus System — cross-project focus view with AI processing  ([`8817acc`])
- **registry**: Phase 1 - skill audit, validation, mtime cache, consolidation, rating warning ([`7f19f8a`])
- **registry**: Phase 2 - add CLI subcommands list/show/clean/rotate  ([`13712aa`])
- **registry**: Add better-sqlite3 with Nix build support  ([`30e8343`])
- **registry**: Phase 1 - ABI fix, schema foundation, getRegistryDbPath ([`266f0b9`])
- **registry**: Phase 2 - migration tool + core SQLite swap  ([`30eb886`])
- **registry**: Phase 3 - FTS5 search, analytics, dual-write, deprecation warning  ([`4b3032e`])
- **registry**: Fix all 9 UAT findings for PA-1099 ([`0453005`])
- **serve**: Add background mode with dtach support ([`5d52205`])
- **routine**: Add auto-resolve engine, clean-merge, dry-run, decision log ([`49d1e7d`])
- **ci**: Add GitHub Actions CI with lint and typecheck ([`5d40193`])
- **idea**: Migrate from file-writing to ticket system ([`2f2aa83`])
- **report**: Migrate from file-writing to ticket system ([`e33f7b2`])
- **routine**: Add stale sub-ticket resolution (F6) to decision flow ([`f559252`])
- **routine**: Remove grace period, auto-merge immediately on MERGEABLE + CI pass ([`ee7e331`])
- **routine**: Add Step 3.6 — return to develop and pull after processing ([`3441759`])
- **activity**: Add post-session thinking/text/tool_use extraction  ([`29ca76c`])
- **activity**: Add backfill script for thinking extraction on old deployments ([`7da4b0c`])
- **tickets**: Deprecate team field in PA ticket system (AVO-042) ([`96f2896`])
- **pa**: Allow URL links as doc_ref attachments  ([`d3f9fc4`])
- **registry**: Phase 1 - core code changes for registry SQLite cleanup  ([`50234b1`])
- **registry**: Phase 2 - add pa registry amend subcommand  ([`d1ba469`])
- **builder**: Phase 1 - create skills/templates/ with 6 lifecycle template files  ([`44f7193`])
- **builder**: Phase 2 - reference standalone templates ([`6d2c8a8`])
- **builder**: Phase 3 - add skills/templates/ to Reference Documents  ([`e942a58`])
- **registry**: Phase 1 - add fallback field to schema and types  ([`20905cf`])
- **deploy**: Phase 2 - add fallback completion marker for foreground modes  ([`16cc6ba`])
- **deploy**: Phase 3 - add background fallback + fix crash handling  ([`45cfa8d`])
- **registry**: Phase 4 - add sweep command for orphaned deployments  ([`40fcf1b`])
- **builder**: Add --ticket passthrough to orchestrator child deployments  ([`2fa6957`])
- **api**: Add branch listing and commit history endpoints  ([`c375a90`])
- **builder**: Implement Phase 2 codectx core parse pipeline  ([`2b13ba7`])
- **builder**: Implement Phase 3 codectx markdown generator + query engine  ([`51b3ea3`])
- **builder**: Implement Phase 3 codectx primer integration + refresh polish  ([`8a51dac`])
- **builder**: Phase 1 - registry query function + deployment API enhancements  ([`81d99fd`])
- **builder**: Phase 2 - Ticket API deployments array + Board API hasRunningDeployment  ([`7f02f8f`])
- **builder**: Phase 1 - Extended git API routes  ([`db3ac3e`])
- **tickets**: Phase 1 - data model + store logic for ticket branch/commit linking  ([`400471d`])
- **tickets**: Phase 2 - CLI flags + display for ticket branch/commit linking  ([`b3475bd`])
- **tickets**: Phase 3 - backfill script for ticket branch/commit linking  ([`230655f`])
- **builder**: Phase 4 - add ticket branch/commit linking to builder instructions ([`64cb095`])
- **builder**: Phase 1 - add POST route for location-aware section insert ([`49f163f`])
- **builder**: Phase 2 - add unit tests and fix insert formula ([`5269f86`])
- **builder**: PA-1126 phase 1 - add MiniMax orchestrator improvements ([`01425d9`])
- **skills**: Add MiniMax orchestrator improvements — path resolution, tool prefs, delegation, tracking, time-boxing ([`197e655`])
- **builder**: PA-1129 phase 1 - use pipe delimiter for linked-commit and linked-branch ([`2b3e1a2`])
- **builder**: PA-1129 phase 2 - fix numstat off-by-one bug ([`48a5c08`])
- **builder**: PA-1128 phase 1-3 — orchestrator Phase 5 rewrite (PR creation + UAT handoff) ([`3ab59f4`])
- **builder**: PA-1125 phase 1 - configurable deployment timeout ([`b544612`])
- **builder**: PA-1131 phase 1 - skip header on empty/null/NA/NULL title ([`02bf429`])
- **builder**: PA-1127 phase 1 - persist deploy-time warnings to warnings.log ([`5b998f0`])
- **api**: PA-1132 phase 1 - server-side text-match for inline comment insertion ([`5e74da9`])
- **serve**: Phase A - branch-specific commits + fix diff endpoint ([`9dfed8d`])
- **builder**: PA-1133 add provider: minimax to orchestrator mode ([`cb7156f`])
- **config**: PA-1133 make default provider/model configurable via config.yaml ([`291f834`])
- **tickets**: Enforce git validation for linked branches/commits ([`7e25fa3`])
- **repo-api**: Add -m --first-parent to fix merge commit diffs ([`84dfea9`])
- **agent-api**: Add self-update endpoint for PA server ([`f5b5d0a`])
- **repo-health**: Phase 1 - Data Layer ([`31d07b4`])
- **maintenance**: Phase 2 - agent skill & mode registration ([`ca0e8dc`])
- **core**: Phase 3 - broaden file deletion policy to cover all files ([`d6c1c33`])
- **builder**: Phase 1 - add post-merge CI polling to routine.md Case B ([`140e5ae`])
- **api**: Phase 1 - default array/scalar fields in POST /api/tickets ([`3df8f12`])
- **deploy**: PA-1020 file-based objective passing ([`8309692`])
- **ticket**: Add pa ticket delete command (soft/hard delete) ([`98f4186`])
- **deploy**: PA-1082 Phase 1 - core resume for foreground modes ([`c6756a5`])
- **registry**: PA-1082 Phase 1 - data layer foundation for resume lineage ([`8fda3a1`])
- **deploy**: PA-1082 Phase 2 - new deployment_id on resume, remove mutation, dedup exec blocks, add CWD and provider warning ([`0979f2e`])
- **requirements**: PA-1153 phase 1 - analyze-auto mode for autonomous requirements analysis ([`f0649f2`])
- **teams**: PA-1083 phase 1 - team consolidation YAML creation ([`2cef331`])
- **deploy**: PA-1083 phase 2 - remove pa daily, migrate template vars to deploy.ts ([`2bfc58b`])
- **builder**: PA-1083 phase 4 - orchestrator process improvements ([`e93b911`])
- **builder**: PA-1154 phase 1 - wrap spawn in nix develop ([`6ea245c`])
- **builder**: PA-1155 phase 1 - implement CI validation improvements ([`b2b0c9f`])
- PA-1161 sprint-master mode cleanup — 3-way team split ([`709aba0`])
- Phase 4 - PA integration for terse-mode ([`9386377`])
- Phase 1 - signal infrastructure setup ([`1bac13d`])
- Phase 2 - signal message extraction ([`b66a85b`])
- Phase 3 - classification & ticket creation ([`480c157`])
- Phase 4 - attachments & scheduling ([`2d45a0e`])
- Replace MiniMax classifier with rule-based router ([`1b7a4c1`])
- Structured Logseq pages + tickets for YouTube/article URLs ([`6f89f01`])
- Add pa health CLI command ([`f42d628`])
- **builder**: Add review-auto gate + fix loop to orchestrator  ([`c0d58a3`])
- **cli**: Add --objective-file and --content-file for shell-safe content input  ([`43e24e7`])
- **agents**: Orchestrator and reviewer do not create tickets  ([`61f6b94`])
- **templates**: Extract orchestration-report template  ([`e9a834a`])
- **orchestrator**: Attach orchestration report to ticket at creation  ([`62abc71`])
- **orchestrator**: Improve orchestrator instruction ([`b29073f`])
- **tickets**: Add doc-ref type taxonomy + helpers  ([`d653428`])
- **tickets**: Two-line doc-ref layout in pa ticket show  ([`97fef90`])
- **tickets**: Inline doc-ref badges in pa ticket list  ([`8eba558`])
- **tickets**: Soft-enforce doc-ref type whitelist in CLI  ([`02ae582`])
- **api**: Add derived title to doc_refs in agent API  ([`7eda17b`])
- **scripts**: Add backfill-uat-doc-refs.ts  ([`1ebf942`])
- **registry**: Add updated event type + pa registry update CLI ([`d705bd1`])

### Documentation

- ROADMAP.md v0.4.0 retrospective and v0.5.0 refresh ([`66920a7`])
- **registry**: Update all docs/skills/primers from JSONL to SQLite references ([`63b8d78`])
- **registry**: Remove all JSONL references from operation/skill files ([`31d3030`])
- **registry**: Phase 3 - skills and docs for SQLite migration  ([`f5d5513`])
- Add codebase context doc and integrate via global_docs (PA-1047 T1) ([`5cb84fa`])
- **requirements**: Mark Phase 2 and AC6 complete for PA-1082 wave3 ([`3009d7e`])
- **templates**: Fix heading hierarchy in orchestration-report template  ([`1c7bbc9`])
- **orchestrator**: Make bracket-every-pa-deploy rule strict  ([`95f87f9`])
- **skills**: Use standard doc-ref type prefixes  ([`0ddfb7c`])

### Fixed

- **board**: Suppress git stderr in resolveProjectFromCwd ([`4c3a43e`])
- **deploy**: Resolve mode-level model for claude CLI --model flag ([`c99a162`])
- **tickets**: Handle missing assignee field in CLI and API  ([`fc67221`])
- **deploy**: Pass deployEnv to background spawn to strip CLAUDECODE ([`f78e128`])
- **ci**: Remove explicit pnpm version from action (packageManager handles it) ([`ffb7f78`])
- **report**: Resolve merge conflict in report.ts ([`0218162`])
- **routine**: Auto-merge runs before dedup skip in Case B ([`d5b98a0`])
- **nix**: Update pnpmDeps hash to fix offline tarball build error  ([`3fd7edc`])
- **nix**: Include runtime scripts in Nix package for thinking extraction  ([`51bfd9a`])
- **builder**: Correct mode name typo in template specs  ([`8e10dea`])
- **codectx**: Remove unused vars causing CI lint failure  ([`59bc5ee`])
- **tickets**: Make linkedBranches/linkedCommits optional in CreateTicketInput ([`727b7cc`])
- **flake**: Update pnpmDeps hash to resolve build error ([`d3f10a8`])
- **tickets**: Use pipe delimiter in linked commit/branch parsing ([`22a8a3f`])
- **builder**: PA-1125 fix lint error - unused source parameter ([`ffe3688`])
- **lint**: Preserve-caused-error in git-validation.ts ([`d549e5e`])
- **self-update**: Remove git pull from spawn command ([`627b75e`])
- **tickets**: Preserve caught SyntaxError as cause in deleteHard ([`f5d75ab`])
- **deploy**: PA-1082 remove unused imports and fix let→const lint errors ([`b19339f`])
- Date-correct routing & reprocess cleanup ([`8080ff9`])
- Use LM project for media tickets ([`886e87f`])
- **CI**: Resolve 5 lint errors blocking PR ([`e5a7161`])
- **trash**: Support directories in move, restore, and purge ([`3319951`])
- **health**: Address UAT review findings ([`53e9c17`])
- **deps**: Bump picomatch to >=4.0.4 for ReDoS CVE  ([`f1672c5`])
- **nix**: Update pnpmDeps hash + add auto-refresh + CI guard (#104) ([`141e9af`])
- **scripts**: Correct import paths in backfill-doc-ref.ts  ([`081bf1f`])
- **shell**: Pa status completion emits bare deploy IDs (#107) ([`b8fcfed`])

## [0.4.5] - 2026-03-26

### Added

- **trash**: Implement pa trash soft-delete protocol ([`316a5d3`])
- **builder**: PA-969 - migrate to instruction: schema and add shared skills ([`ff752ef`])
- **requirements**: PA-969 - restructure requirements team with analyze mode ([`936ff62`])
- **requirements**: PA-982 - KPI framework and mode templates ([`8ca209f`])
- **ticket**: Phase 3 - wire formatTicketCard to CLI show command ([`93be458`])
- **api**: Phase 4 - add ?render=html to GET /api/tickets/:id ([`e8ba182`])
- **api**: Phase 5 - add GET /api/images endpoint for image serving ([`b804afd`])
- **teams**: Add pa-session-log to all team YAMLs ([`3e7728f`])
- **registry**: Add rating options to pa registry complete command ([`616833b`])
- **completions**: Add fish completions for newly added CLI options ([`75089cc`])
- **deploy**: Phase 1 - copy primer to deployment workspace ([`4d9d788`])
- **agent-api**: Phase 2 - add GET /api/deployments/:id detail endpoint ([`0e10b74`])
- **fish-completion**: Improve status/objective auto-fill and enable proactive worker mode ([`3e8bb7e`])
- **builder**: Per-mode model opus for all deploy modes (#30) ([`65e2f8f`])

### Fixed

- **orchestrator**: Add imperative delegation instruction to primer ([`7ef3651`])

## [0.4.4] - 2026-03-26

### Added

- **trash**: Implement pa trash soft-delete protocol ([`316a5d3`])
- **builder**: PA-969 - migrate to instruction: schema and add shared skills ([`ff752ef`])
- **requirements**: PA-969 - restructure requirements team with analyze mode ([`936ff62`])
- **requirements**: PA-982 - KPI framework and mode templates ([`8ca209f`])
- **ticket**: Phase 3 - wire formatTicketCard to CLI show command ([`93be458`])
- **api**: Phase 4 - add ?render=html to GET /api/tickets/:id ([`e8ba182`])
- **api**: Phase 5 - add GET /api/images endpoint for image serving ([`b804afd`])
- **teams**: Add pa-session-log to all team YAMLs ([`3e7728f`])
- **registry**: Add rating options to pa registry complete command ([`616833b`])

### Fixed

- **orchestrator**: Add imperative delegation instruction to primer ([`7ef3651`])

## [0.4.3] - 2026-03-25

### Added

- **api**: PA-910 — POST /api/deploy returns HTTP 202 immediately ([`90802f0`])
- **deploy**: PA-948 — add --provider minimax flag for Minimax API routing ([`34c52dd`])
- **tickets**: PA-949 phase 1 - add marked + marked-terminal deps ([`3a6afd3`])
- **tickets**: PA-949 phase 2 - create display module ([`d90c33f`])
- **primer**: PA-950 phase 1 - refactor selectModules to tiered injection ([`a8a047e`])
- **primer**: PA-950 phase 2 - clean YAML global_docs and add Phase 0 ([`df57367`])
- **types**: PA-953 phase 2 - add instruction field and SkillEntry type ([`7691716`])
- **primer**: PA-953 phase 3 - add resolveSharedSkill and mode skills injection ([`9990826`])
- **requirements**: PA-953 phase 4 - pilot new schema with requirements team ([`f9b4912`])
- **primer**: PA-953 phase 8 - WHO/WHY/WHAT/HOW restructure ([`dbd086e`])

### Fixed

- **deploy**: PA-948 review fixes — env file security, model vars, status display ([`914da02`])
- Update pnpmDeps hash for ansi-escapes-7.3.0 ([`d6eff4a`])

## [0.4.2] - 2026-03-24

### Added

- **skills**: PA-944 — Living Document Convention ([`7e62306`])

## [0.4.1] - 2026-03-24

### Added

- **tickets**: PA-942 phase 1 — multi-doc-ref type & CRUD implementation ([`78f7f7f`])
- **tickets**: PA-942 phase 2 — migration script, backfill update, skill file updates ([`6bbbe1d`])

## [0.4.0] - 2026-03-24

### Added

- **chore**: Phase 1 - version strategy foundation  ([`3cd4ba8`])
- **chore**: Phase 2 - enhance version_bump.sh  ([`f483baf`])
- **docs**: Phase 3 - retroactive tags and changelog backfill  ([`3a552d9`])
- **docs**: Phase 4 - version roadmap and milestone tags  ([`cbcd9ab`])
- **tickets**: Add --tags, --exclude-tags, --search to pa ticket list  ([`dc473ab`])
- **registry**: Add pa registry complete command  ([`25a9e56`])
- **tickets**: Add team/agent assignee validation and smart filtering  ([`3f82140`])
- **tickets**: Add assignee format migration script  ([`90bc511`])
- **primer**: PA-931 — primer template system fixes (F1-F5) ([`c4bb8de`])
- **teams,status**: PA-934 — board & teams display filters (F1-F5) ([`c8a5aed`])
- **tickets,board**: PA-936 — FYI ticket lifecycle fixes (F1-F5) ([`18bc6c3`])

### Documentation

- **skills**: Update --assignee examples to team/agent format  ([`1580418`])

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

