# personal-assistant (`pa`)

CLI agent team orchestrator for NixOS. Deploys AI agent teams via structured primers and `claude` CLI, managed through systemd user timers.

## Quick Start

```bash
pa teams                          # List available teams
pa deploy maintenance             # Deploy a team (background)
pa deploy maintenance --dry-run   # Preview the primer without running
pa status                         # Check deployment status
pa daily plan                     # Run daily planning workflow
pa timers                         # List scheduled timers
```

## Commands

| Command | Description |
|---|---|
| `pa teams` | List available teams from config and install dirs |
| `pa deploy <team> [options]` | Deploy an agent team |
| `pa daily <mode> [date]` | Daily lifecycle — `plan`, `progress`, or `end` |
| `pa status [deploy-id]` | Show deployment status table or detail view |
| `pa schedule <spec> <repeat> [times]` | Create systemd timer for a team |
| `pa timers` | List active `pa-*` systemd timers |
| `pa remove-timer <name>` | Stop and remove a scheduled timer |
| `pa idea` | Log an idea interactively |

See [docs/commands.md](docs/commands.md) for full usage and examples.

## Architecture

```
pa CLI (Commander.js)
  ├── deploy → parse team YAML → generate primer → spawn claude
  ├── daily  → inject mode objective → deploy daily team
  ├── status → read registry SQLite → check PID liveness → format table
  └── schedule → generate systemd .service + .timer → enable

Data flow:
  teams/*.yaml  →  primer (markdown)  →  claude --print  →  registry.db
       ↑                                                         ↓
  skills/*.md                                              pa status
```

See [docs/architecture.md](docs/architecture.md) for details.

## Project Structure

```
├── src/
│   ├── cli.ts              # Entry point — Commander command definitions
│   ├── commands/            # One file per subcommand
│   │   ├── deploy.ts        # Team deployment (background/foreground/dry-run)
│   │   ├── daily.ts         # Daily lifecycle wrapper
│   │   ├── status.ts        # Deployment status from registry
│   │   ├── schedule.ts      # Systemd timer creation
│   │   ├── teams.ts         # List teams
│   │   ├── timers.ts        # List timers
│   │   ├── remove-timer.ts  # Remove timer
│   │   └── idea.ts          # Interactive idea logger
│   ├── lib/
│   │   ├── types.ts         # Shared types (TeamConfig, RegistryEvent, etc.)
│   │   ├── config.ts        # Config loader (user overrides + env vars)
│   │   ├── paths.ts         # Path resolution (PA_HOME, PA_DATA, etc.)
│   │   ├── registry.ts      # Registry JSONL read/write with flock
│   │   ├── yaml-parser.ts   # Team YAML loader
│   │   └── primer.ts        # Primer document generator
│   └── utils/
│       └── process.ts       # Subprocess helpers (detached spawn)
├── teams/                   # Team definitions (YAML)
├── skills/                  # Agent skill documents (Markdown)
├── flake.nix                # Nix package + devShell
├── package.json
├── tsconfig.json
└── tsup.config.ts
```

## Configuration

PA resolves paths in layers:

| Variable | Default | Description |
|---|---|---|
| `PA_HOME` | Set by Nix wrapper | Read-only install dir (teams/, skills/) |
| `PA_DATA` | `~/.local/share/personal-assistant` | Mutable data (primers/, logs/) |
| `PA_CONFIG` | — | User override dir (teams/, skills/ that shadow PA_HOME) |
| `PA_BIN` | `$PA_HOME/../bin` | Wrapped binaries directory |
| `PA_MAX_RUNTIME` | `1800` | Max deployment runtime in seconds |

User config file: `~/.config/sinh-x/personal-assistant/config.yaml`

## Development

```bash
# Enter devshell (direnv auto-activates, or manually):
nix develop

# Build
pnpm install
pnpm build

# Type check
pnpm typecheck

# Run locally
node dist/cli.mjs teams
node dist/cli.mjs deploy maintenance --dry-run

# Build Nix package
nix build .#personal-assistant
result/bin/pa help
```

See [docs/development.md](docs/development.md) for adding new commands and teams.

## Teams & Skills

Teams are YAML configs in `teams/`. Each team has agents with assigned skills (markdown docs in `skills/`). Global skills in `skills/global/` apply to all agents.

See [docs/teams.md](docs/teams.md) for how to create and configure teams.

## Philosophy

Learned from ATM and yoyo-evolve, built from scratch:
- **ATM insight**: Deployment is just a markdown primer fed to `claude` CLI
- **yoyo-evolve insight**: Identity files + journal + skills as discrete units
- **Own approach**: Declarative YAML config, TypeScript orchestration, NixOS-native scheduling
