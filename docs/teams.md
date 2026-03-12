# Teams & Skills

## Team Configuration

Teams are defined as YAML files in `teams/`. Each file defines a team's identity, agents, and objective.

### Structure

```yaml
name: maintenance
description: "Investigate, diagnose, and fix issues in the personal-assistant system"

context:
  organization: sinh-x              # Optional metadata
  notes: "Solo agent. Deploy with --objective for specific issues."

variables:
  project_root: /path/to/project    # Available for reference in skills

agents:
  - name: mechanic
    role: "Investigate issues, apply fixes, run health checks"
    skill: skills/maintenance.md     # Path relative to PA_HOME

objective: |
  You are a SOLO operator — do ALL work yourself, do NOT spawn sub-agents.

  Working directory: /path/to/project
  ...
```

### Fields

| Field | Required | Description |
|---|---|---|
| `name` | Yes | Team identifier |
| `description` | Yes | What the team does |
| `context` | No | Metadata (organization, notes) |
| `variables` | No | Key-value pairs referenced in skills |
| `agents` | Yes | List of agents with name, role, skill |
| `objective` | Yes | Default instructions (can be overridden with `--objective`) |

### Agent Definition

Each agent needs:
- **name** — Identifier used in primers and task assignment
- **role** — One-line description of what this agent does
- **skill** — Path to a markdown skill file (relative to PA_HOME or PA_CONFIG)

## Skills

Skills are markdown documents in `skills/` that define an agent's capabilities, scope, and rules.

### Anatomy of a Skill

```markdown
# Skill: Maintenance — Investigate & Fix

You are the maintenance agent — a solo operator that ...

## Scope
- Scripts, skills, teams, flake, infrastructure

## Core Responsibilities
### 1. Investigate Issues
...
### 2. Fix Issues
...

## Workflow
1. Read objective
2. Gather context
3. Diagnose
4. Fix
5. Verify
6. Document

## Rules
- Read before writing
- Test your fixes
- If unsure, stop and report
```

### Global Skills

Files in `skills/global/` are injected into every deployment primer. Use these for cross-cutting standards (coding conventions, communication protocols, reporting formats).

Global skills from PA_CONFIG shadow those from PA_HOME (matched by filename).

## Creating a New Team

1. Copy `teams/example.yaml` as a starting point:
   ```bash
   cp teams/example.yaml teams/my-team.yaml
   ```

2. Write a skill document:
   ```bash
   # Create skills/my-team.md with scope, workflow, and rules
   ```

3. Edit the YAML — set name, description, agent skill path, and objective

4. Test with dry run:
   ```bash
   pa deploy my-team --dry-run
   ```

5. Deploy:
   ```bash
   pa deploy my-team --foreground   # First run: watch it work
   pa deploy my-team                # Later: background mode
   ```

## Existing Teams

| Team | Description |
|---|---|
| `daily` | Daily lifecycle — plan, progress, end-of-day |
| `maintenance` | System health checks and fixes |
| `builder` | Multi-phase implementation projects |
| `secretary` | Intake, routing, and organization |
| `house-chores` | Survey and commit uncommitted changes |
| `requirements` | Requirements gathering and analysis |
| `youtube-processor` | Process YouTube videos to structured notes |

## Path Resolution

Teams and skills are resolved with PA_CONFIG taking priority over PA_HOME:

1. `$PA_CONFIG/teams/<name>.yaml` — user overrides (checked first)
2. `$PA_HOME/teams/<name>.yaml` — Nix-installed defaults (fallback)

Same for skills: `$PA_CONFIG/skills/` → `$PA_HOME/skills/`.

This lets you customize team configs without touching the Nix store.
