# Changelog

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
