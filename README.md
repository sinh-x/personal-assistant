# personal-assistant

CLI-driven agent team orchestrator for NixOS. Generates deployment primers from config, runs them via `claude` CLI, schedules with systemd user timers.

## Quick Start

```bash
# Define a team
cp teams/example.yaml teams/my-team.yaml
vim teams/my-team.yaml

# Generate primer and deploy
./deploy.sh my-team

# Schedule recurring deployment
./schedule.sh my-team daily 09:00
```

## Structure

```
IDENTITY.md          # What this system is (immutable principles)
JOURNAL.md           # Append-only decision log
teams/               # Team definitions (YAML)
skills/              # Reusable skill files (markdown)
primers/             # Generated primers (gitignored, ephemeral)
deploy.sh            # Generate primer + run claude
schedule.sh          # Create/manage systemd user timers
list-timers.sh       # List active scheduled deployments
remove-timer.sh      # Remove a scheduled deployment
```

## Philosophy

Learned from ATM and yoyo-evolve, built from scratch:
- **ATM insight**: Deployment is just a markdown primer fed to `claude` CLI
- **yoyo-evolve insight**: Identity files + journal + skills as discrete units
- **Own approach**: Declarative YAML config, shell scripts, NixOS-native scheduling
