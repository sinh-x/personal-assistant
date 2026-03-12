# Changelog

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
