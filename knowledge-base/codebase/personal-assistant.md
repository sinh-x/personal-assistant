# Personal Assistant — Codebase Context

> **Purpose:** Provides AI agents with structured understanding of the personal-assistant codebase architecture, key modules, and relationships.
> **Last updated:** 2026-04-09
> **Sync trigger:** Manual — run after significant architectural changes (new commands, new lib modules, new API routes, or significant refactors)

---

## Overview

Personal-assistant (`pa`) is a TypeScript CLI tool written in Node.js that orchestrates AI agent teams via deployment primers. Agents are powered by the `claude` CLI and configured via YAML team files.

**Key architectural layers:**
```
CLI Entry Point (src/cli.ts)
  └── Commands (src/commands/)
        ├── deploy.ts       — Generates primer, spawns claude
        ├── daily.ts        — Daily lifecycle management
        ├── ticket.ts        — Ticket CRUD operations
        ├── teams.ts        — Team management
        ├── serve.ts        — Agent API server (Hono)
        └── ...             — Other operational commands
  └── Library (src/lib/)
        ├── primer.ts       — Markdown primer generation
        ├── registry.ts     — Deployment registry (SQLite)
        ├── config.ts       — Config loading
        ├── repos.ts        — Repo root resolution
        ├── yaml-parser.ts  — Team YAML parsing
        └── ...             — Other shared utilities
```

---

## Key Modules

### 1. `src/commands/deploy.ts` — Team Deployment Orchestration

**Purpose:** Parses team YAML config, generates markdown primers, spawns `claude` CLI for agent execution.

**Exports:**
- `deployCommand(team: string, opts: DeployOptions): void` — Main entry point

**Key responsibilities:**
1. Resolve team YAML from `teams/<name>.yaml`
2. Parse deploy mode (implement, orchestrator, worker, etc.)
3. Generate primer via `generatePrimer()` from `src/lib/primer.ts`
4. Write primer to `~/.local/share/personal-assistant/primers/<team>-<deployId>-primer.md`
5. Spawn `claude` process (foreground, background, or direct mode)
6. Write deployment events to registry SQLite

**Key options:**
- `--mode <id>` — Select deploy mode (reads mode file as objective)
- `--ticket <id>` — Link deployment to a ticket
- `--repo <name>` — Override repo context
- `--objective <text>` — Append extra instructions
- `--provider minimax` — Use Minimax API instead of Anthropic

**Relationships:**
- Uses `parseTeamYaml()` from `src/lib/yaml-parser.ts`
- Uses `generatePrimer()` from `src/lib/primer.ts`
- Uses `appendRegistryEvent()` from `src/lib/registry.ts`
- Uses `resolveRepo()` from `src/lib/repos.ts`

**Build output:** Compiled to `dist/commands/deploy.js` and executed via `pa deploy <team>`.

---

### 2. `src/lib/primer.ts` — Markdown Primer Generation

**Purpose:** Generates structured markdown deployment primers from YAML team configs and skill docs.

**Exports:**
- `generatePrimer(opts: PrimerOptions): string`
- `resolveGhRepo(repoRoot: string): string | undefined`

**Key responsibilities:**
1. Build `<deployment-context>` block with deployment_id, team_name, ticket_id, etc.
2. Inject team description and hierarchy
3. Load mode-specific objective from YAML or mode file
4. Resolve and inject shared skills (reads SKILL.md frontmatter only)
5. Inject core standards (`core.md` as global base)
6. Handle `global_docs` from team/mode config (injected as `<global-skill>` blocks)
7. Inject active bulletins
8. Apply template variables (`{{TODAY}}`, `{{TEAM_NAME}}`, etc.)
9. Resolve reference documents (repo context, templates)

**Global docs mechanism:**
- `teamConfig.global_docs` — team-level baseline docs
- `modeConfig.global_docs` — per-mode extension
- Deduplicated and injected as `<global-skill name="...">` blocks

**Template variables:**
- `TODAY`, `YEAR`, `MONTH`, `HOME`, `TEAM_NAME`, `MODE_ID`, `DEPLOY_ID`
- `OUTPUT_DIR`, `REPO_KEY`, `PROJECT_PREFIX`, `GH_REPO`
- `DEVELOP_BRANCH`, `MAIN_BRANCH`

**Skills resolution:**
- Skills listed in `modeConfig.skills[]` with `inject-as: shared-skill`
- Summary table only (reads frontmatter via `resolveSkillSummary()`)

---

### 3. `src/commands/ticket.ts` — Ticket Management CLI

**Purpose:** Full ticket lifecycle management (create, read, update, list, comment).

**Exports:**
- `createTicketCommand(): program.Command` — Register `pa ticket` subcommands

**Subcommands:**
- `pa ticket create --project <key> --title <text> [--assignee <team>] [--priority P|M|C] [--estimate S|M|L] [--tags <tags>]`
- `pa ticket list [--assignee <name>] [--status <status>] [--project <key>]`
- `pa ticket show <id>`
- `pa ticket update <id> [--status <status>] [--assignee <name>] [--doc-ref <path>] [--tags <tags>]`
- `pa ticket comment <id> --author <name> --content <text>`

**Ticket status lifecycle:**
```
backlog → pending-triage → requirement-review → pending-implementation → implementing → review-uat → done
                  ↓                                              ↓
              archived                                      bug-fix
```

**Key patterns:**
- Ticket store: `src/lib/tickets/store.ts` — flat-file JSON storage in `~/Documents/ai-usage/tickets/`
- Board view: `src/lib/tickets/board.ts` — Kanban board grouped by status
- `doc_refs` field: array of `{ type: 'primary'|'requirements'|'implementation', path: string }`
- Ticket assignment uses team-qualified format: `builder/team-manager`, `requirements/researcher`, `sinh`

---

### 4. `src/lib/registry.ts` + `src/lib/registry-db.ts` — Deployment Registry

**Purpose:** Tracks all PA deployments in a SQLite database with WAL mode.

**Key functions:**
- `appendRegistryEvent(event: RegistryEvent): void` — Write event to DB
- `getDeploymentEvents(deployId: string): RegistryEvent[]` — Read events for a deployment
- `getDeploymentStatus(deployId: string): DeploymentStatus` — Compute status from events

**Event types:**
- `started` — Deployment initiated
- `pid` — Process ID recorded
- `completed` — Successful completion
- `crashed` — Exit with non-zero
- `amended` — Post-completion update

**Status values:** `success`, `partial`, `failed`, `crashed`

**Registry DB path:** `~/Documents/ai-usage/deployments/registry.db`

**Completion marker command:** `pa registry complete <deploy-id> --status <status> --summary <text>`

---

### 5. `src/commands/serve.ts` + `src/lib/agent-api/` — Agent API Server

**Purpose:** HTTP API server (Hono.js) providing endpoints for agent-to-agent communication, ticket access, and deployment management.

**Server startup:** `pa serve [--port <n>] [--host <addr>] [--background]`

**Key routes:**
- `/api/deployments/*` — Deployment CRUD and activity
- `/api/tickets/*` — Ticket operations
- `/api/teams/*` — Team configuration
- `/api/repos/*` — Repo registry
- `/api/inbox/*` — AI-usage inbox management (sinh-inputs)
- `/api/sinh-inputs/*` — Sinh's input queue for agent communication
- `/ws` — WebSocket hub for real-time updates

**Agent API index:** `src/lib/agent-api/index.ts` — wires routes together

**Key patterns:**
- WebSocket watchers: `src/lib/agent-api/ws/watchers.ts` — file-based change detection
- Sandbox utils: `src/lib/agent-api/utils/sandbox.ts` — safe shell command execution
- Markdown utils: `src/lib/agent-api/utils/markdown.ts` — markdown rendering

---

### 6. `src/lib/yaml-parser.ts` — Team YAML Parsing

**Purpose:** Parses team YAML files into typed `TeamConfig` objects.

**Exports:**
- `parseTeamYaml(filePath: string): TeamConfig`

**Key types parsed:**
- `TeamConfig` — top-level team definition
- `DeployMode` — per-mode configuration (id, label, objective, agents, skills, model, provider, global_docs)
- `Agent` — agent definition (name, role, instruction, skill, model)
- `SkillEntry` — `{ name: string, 'inject-as': 'global-skill'|'shared-skill'|'reference' }`

**YAML structure handled:**
```yaml
name: builder
description: "..."
default_mode: implement
deploy_modes:
  - id: implement
    agents: []
    objective: teams/builder/modes/implement.md
    skills:
      - name: pa-cli
        inject-as: shared-skill
    global_docs:
      - knowledge-base/codebase/personal-assistant.md
```

---

### 7. `src/lib/types.ts` — Shared TypeScript Types

**Purpose:** Central type definitions for the entire PA system.

**Key types:**
- `TeamConfig` — parsed from team YAML
- `DeployMode` — mode-specific configuration
- `Agent` — agent definition within a team
- `RegistryEvent` — event written to deployment registry
- `DeploymentStatus` — computed deployment state
- `PAConfig` — PA configuration paths (configDir, dataDir, homeDir, binDir)
- `SkillEntry` — skill injection configuration

---

### 8. `src/commands/daily.ts` — Daily Lifecycle Management

**Purpose:** Manages the daily agent workflow (plan, progress, end modes).

**Modes:**
- `pa daily plan [YYYY-MM-DD]` — Create daily plan with time budget
- `pa daily progress [YYYY-MM-DD]` — Check-in during the day
- `pa daily end [YYYY-MM-DD]` — Wrap up and summarize the day

**Key patterns:**
- Uses `teams/daily.yaml` team config (name: "daily")
- Generates temp YAML for plan/end: `daily-end-<timestamp>.yaml`
- `deploy.ts` uses `teamConfig.name` ("daily") as canonical team name
- Creates workspace at `~/Documents/ai-usage/agent-teams/daily/`
- Writes session artifacts: `YYYY-MM-DD-daily-plan.md`, etc.

**Relationship with deploy.ts:** Both use `generatePrimer()` but daily has custom time budget tracking and mode-specific objective files.

---

## How to Keep This Doc in Sync

**When to update:**
1. New command added to `src/commands/`
2. New library module added to `src/lib/`
3. New API route added to `src/lib/agent-api/routes/`
4. Significant refactor of an existing module (changed responsibilities or exports)
5. New deploy mode added to any team YAML

**How to update:**
1. Edit this file directly — no automation, manual trigger only
2. Run `pnpm build` to verify no TypeScript errors
3. Commit with message: `docs: update codebase context for <change-summary>`

**Sync trigger command:**
```bash
# After making significant changes to the codebase
# Manually review and update this file
code ~/Documents/ai-usage/agent-teams/builder/artifacts/knowledge-base/codebase/personal-assistant.md
```

---

## Verification Targets

| Target | How to verify |
|--------|---------------|
| TS-1: File exists | `ls knowledge-base/codebase/personal-assistant.md` |
| TS-2: Primer integration | `pa deploy builder --mode implement --dry-run --ticket PA-1047` and check primer includes the codebase doc |

---

## Related Documents

- `skills/global/standards/codebase-exploration.md` — Codebase exploration patterns for agents
- `src/lib/primer.ts` — Primer generation (source of truth for global_docs mechanism)
- `teams/builder.yaml` — Builder team config (where `global_docs` is configured for implement mode)
- `knowledge-base/repo-context/pa.md` — Repo-level context (auto-generated from repos.yaml)