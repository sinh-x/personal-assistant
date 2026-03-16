# Changelog

## 0.1.12 (2026-03-16)

### Added
- **RPM Weekly Review system** — `pa deploy rpm --mode=weekly-review` launches an interactive session that presents weekly avo time by RPM area, completed vs skipped MAP items, and guides block updates. New `skills/rpm/weekly-review.md` and `skills/rpm/weekly-gather.md` skills added.
- **Schedulable RPM gather team** — `pa schedule rpm-gather weekly` sets up a background Sunday gather that collects avo time, daily summaries, and completed MAP items into `agent-teams/rpm/inbox/` for review. New `teams/rpm-gather.yaml` added.
- **RPM daily context injection** — `pa daily plan` now includes a "Today's RPM Focus" section showing active results. Each avo task is labeled with its mapped RPM result ID or flagged as `[UNALIGNED]` when no mapping is found. Supports `#rpm:rN` manual tag override.
- **RPM block management** — `pa deploy rpm --interactive` guides creation and updates of RPM blocks (Result + Purpose + MAP). Blocks stored as YAML at `agent-teams/rpm/rpm-blocks.yaml` and mirrored to Anytype. Supports 4 life areas (work, learning, health, relationships) and 3 horizons (project, monthly, weekly).

## 0.1.9 (2026-03-15)

### Added
- `deploy_modes:` section in all 9 PA team YAML files — declares which modes are available for phone-triggered deployments, with `phone_visible` flag to control what appears in the Avodah phone app
- `daily` team deploy modes map to `pa daily <mode>` (`plan`, `progress`, `end`); all other teams map to `pa deploy <team> [--flag]`

## 0.1.8 (2026-03-15)

### Added
- Secretary `--route-decisions` mode — automated pipeline that processes Sinh's `approved/`, `rejected/`, and `deferred/` folders and routes documents to the right team inboxes without manual intervention
- Routing fields guidance in `standards.md` — explains why `From:` and `To:` fields are mandatory on all documents, with agent self-validation requirement
- `--route-decisions` CLI flag for `pa deploy` — injects `mode: route-decisions` into the primer so the secretary skips its normal phases and runs the router instead

### Changed
- All 4 agent document templates in `standards.md` (review-request, FYI, work-report, team-to-team) now explicitly show `From:` and `To:` with inline routing comments
- `requirements/analyze.md` Output section now explicitly names `From:` and `To:` fields (not just a reference to standards.md)
- Secretary `coordinate.md` Phase 3 briefing now shows live count of pending items in `secretary/pending-route/`

## 0.1.7 (2026-03-15)

### Added
- `ongoing/` folder and claim/release protocol for all agent teams — items move `inbox/ → ongoing/` when picked up, `ongoing/ → done/` on completion, `ongoing/ → inbox/` on abort
- Secretary stale-ongoing detection — items stuck in `ongoing/` for >3 days are automatically re-queued to `inbox/`

## 0.1.6 (2026-03-14)

### Added
- `--team-model` and `--agent-model` CLI flags for `pa deploy` — override the model used for the team-manager and individual agents (haiku / sonnet / opus)
- Model policy section in deployment primers — shows which model each agent will use before the run starts
- Sonnet floor policy — agents cannot be downgraded below Sonnet regardless of YAML setting

## 0.1.5 (2026-03-14)

### Added
- Knowledge Hub team — new team with gather, curate, facilitate, and analyze skills for managing feeds and distilling insights
- Migrated youtube-processor workflow into knowledge-hub team
- Secretary conversational interactive mode (phase 1) — natural language inbox coordination, approve/reject/defer actions, confirmation-first writes, daily progress board integration

### Changed
- Builder skill expanded to support any sinh-x repo (not just personal-assistant) — specify `repo_path` in plan documents
- Builder pre-flight checks — 4-step branch verification before touching any code; writes failed work report on unexpected branch
- Removed hardcoded `project_root` variable from `teams/builder.yaml`
- Fixed work report path bug: `sinh-inputs/sinh-inputs/inbox` → `sinh-inputs/inbox`

## 0.1.3 (2026-03-13)

### Added
- Inbox document type routing and taxonomy (Type field in authoring templates)
- Rich human feedback support (reject reasons, chips, what-to-fix)
- Standards.md updated with WFR startup sequence and Type field in all authoring templates

## 0.1.2 (2026-03-12)

### Added
- Fish shell autocompletion for all 8 `pa` subcommands (`teams`, `deploy`, `daily`, `status`, `schedule`, `timers`, `remove-timer`, `idea`)
- Dynamic completions for team names, deployment IDs, and timer names
- Completions auto-installed via Nix to `$out/share/fish/vendor_completions.d/pa.fish`

## 0.1.1 (2026-03-12)

### Added
- Standardized agent output workflow with `sinh-inputs/inbox` routing
- Deploy defaults to foreground mode; added `--background` flag for automated/timer use
- Fixed systemd timer services with `KillMode=process`

## 0.1.0 (2026-03-12)

### Added
- Full TypeScript rewrite of the PA CLI (migrated from bash)
- 8 subcommands: `teams`, `deploy`, `daily`, `status`, `schedule`, `timers`, `remove-timer`, `idea`
- Nix flake packaging with `makeWrapper`
- Primer generation, registry tracking, systemd timer scheduling
- Builder team and direnv devshell
