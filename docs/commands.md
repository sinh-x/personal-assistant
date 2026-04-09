# Commands Reference

Complete reference for all 15 `pa` subcommands.

---

## `pa teams [name]`

Show agent team workflow status.

**Synopsis:** `pa teams [name]`

**Description:**

Without `name`: prints a summary table of all agent teams (from `~/Documents/ai-usage/agent-teams/`) showing per-status ticket counts and any running deployment.

With `name`: shows a detailed kanban board for one team — tickets grouped by status column.

**Arguments:**

| Argument | Type | Description |
|----------|------|-------------|
| `name` | string (optional) | Team name for detailed view (e.g. `builder`) |

**Examples:**

```bash
pa teams                   # Summary table: all teams with ticket counts
pa teams builder           # Kanban board for the builder team
```

---

## `pa board`

Show the project-wide kanban board.

**Synopsis:** `pa board [options]`

**Description:**

Displays all tickets grouped by status with assignee column. Defaults to all projects. Backlog and archived tickets are excluded by default.

**Options:**

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--project <name>` | string | all projects | Filter by project key (e.g. `pa`, `avodah`) |
| `--assignee <name>` | string | — | Filter by assignee name |

**Examples:**

```bash
pa board                        # All projects, all active tickets
pa board --project pa           # personal-assistant tickets only
pa board --assignee builder     # Tickets assigned to builder team
```

---

## `pa deploy <team> [options]`

Deploy an agent team.

**Synopsis:** `pa deploy <team> [options]`

**Description:**

Generates a markdown primer from the team's YAML config (plus global skills), then spawns `claude` to execute it. By default, runs in background mode.

**Arguments:**

| Argument | Type | Description |
|----------|------|-------------|
| `team` | string (required) | Team name or path to a YAML file |

**Options:**

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--dry-run` | boolean | false | Generate and print the primer without running claude |
| `--background` | boolean | false | Run in background (default for timers/automated use) |
| `--interactive` | boolean | false | Run in foreground, user approves each tool call |
| `--objective <text>` | string | — | Append extra instructions to the team objective |
| `--direct` | boolean | false | Lightweight direct mode — no sub-agents, skip-permissions |
| `--team-model <model>` | string | — | Model for the team-manager process (`haiku\|sonnet\|opus`) |
| `--agent-model <model>` | string | — | Model for all named agents, overrides per-agent YAML (`haiku\|sonnet\|opus`) |
| `--mode <mode-id>` | string | — | Deploy using a specific mode file as the objective |
| `--list-modes` | boolean | false | List available modes for the team and exit |
| `--repo <name>` | string | — | Target repo name from repos.yaml (overrides CWD detection) |
| `--ticket <id>` | string | — | Link deployment to a ticket ID (e.g. `PA-042`) |
| `--timeout <seconds>` | number | 2700 | Override deployment timeout (min: 60, max: 7200) |

**Environment:**

| Variable | Effect |
|----------|--------|
| `PA_MAX_RUNTIME` | Override timeout (default: 2700s). Takes precedence over --timeout CLI flag. Example: `PA_MAX_RUNTIME=3600 pa deploy builder` |

**Timeout Precedence:** `PA_MAX_RUNTIME` env var > `--timeout` CLI flag > mode timeout (YAML) > team timeout (YAML) > 2700s default.

**Examples:**

```bash
pa deploy maintenance                              # Background deployment (default)
pa deploy maintenance --dry-run                    # Print primer, don't execute
pa deploy builder --objective "Fix PA-042"         # Append extra instructions
pa deploy builder --team-model opus --ticket PA-042
pa deploy builder --list-modes                     # List available modes
pa deploy builder --timeout 3600                   # 1-hour timeout
pa deploy builder --timeout 120                    # 2-minute timeout (min: 60)
```

---

## `pa daily <mode> [date] [options]`

Run the daily lifecycle workflow.

**Synopsis:** `pa daily <mode> [date] [options]`

**Description:**

Wraps the daily team deployment with preset objectives for three lifecycle stages.

**Arguments:**

| Argument | Type | Description |
|----------|------|-------------|
| `mode` | string (required) | `plan` \| `progress` \| `end` |
| `date` | string (optional) | Target date in `YYYY-MM-DD` format (defaults to today) |

**Modes:**

| Mode | Typical Time | Output Location |
|------|-------------|-----------------|
| `plan` | 05:00 | `sinh-inputs/inbox/<date>-plan-draft.md` |
| `progress` | 14:00 | `daily/<year>/<month>/<date>-progress.md` |
| `end` | 21:00 | `daily/<year>/<month>/<date>-daily.md` |

**Options:**

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--dry-run` | boolean | false | Generate and print the primer without running claude |
| `--background` | boolean | false | Run in background (default for timers/automated use) |
| `--interactive` | boolean | false | Run in foreground, user approves each tool call |
| `--review` | boolean | false | Interactive review mode: `end`=review+synthesize, `plan`=finalize draft |

**Examples:**

```bash
pa daily plan                         # Morning plan for today
pa daily progress                     # Mid-day check
pa daily end                          # End-of-day summary
pa daily plan 2026-03-15              # Plan for a specific date
pa daily plan --dry-run               # Preview the primer
pa daily end --review                 # Interactive end-of-day with review
```

---

## `pa status [deploy-id] [options]`

Show deployment status.

**Synopsis:** `pa status [deploy-id] [options]`

**Description:**

Without `deploy-id`: prints a table of all recent deployments from the registry. With `deploy-id`: shows detail view for a specific deployment.

**Arguments:**

| Argument | Type | Description |
|----------|------|-------------|
| `deploy-id` | string (optional) | Deployment ID for detail view (e.g. `d-7ae0a9`) |

**Options:**

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--running` | boolean | false | Show only currently running deployments |
| `--team <name>` | string | — | Filter by team name |
| `--wait` | boolean | false | Block until deployment reaches a terminal state |
| `--report` | boolean | false | Show the work report for a deployment |
| `--artifacts` | boolean | false | List artifact files for a deployment |
| `--activity` | boolean | false | Show agent activity timeline for a deployment |

**Status Icons:**

| Symbol | Meaning |
|--------|---------|
| `[>>]` | Running (PID alive) |
| `[OK]` | Completed successfully |
| `[..]` | Partial success |
| `[!!]` | Crashed or failed |
| `[??]` | Dead (PID gone, no completion event) |

**Examples:**

```bash
pa status                          # All recent deployments (table)
pa status --running                # Only running deployments
pa status --team builder           # Filter by team name
pa status d-7ae0a9                 # Detail view for specific deployment
pa status d-7ae0a9 --activity      # Agent activity timeline
```

---

## `pa schedule <spec> <repeat> [times...]`

Schedule a team deployment with systemd user timers.

**Synopsis:** `pa schedule <spec> <repeat> [times...]`

**Description:**

Creates a systemd user timer and service unit for recurring deployments. The timer is named `pa-<spec-slug>.timer`.

**Arguments:**

| Argument | Type | Description |
|----------|------|-------------|
| `spec` | string (required) | Team name (e.g. `maintenance`) or `daily:<mode>` (e.g. `daily:plan`) |
| `repeat` | string (required) | Interval: `hourly` \| `daily` \| `weekly` \| `monthly` |
| `times...` | string[] (optional) | One or more `HH:MM` times |

**Examples:**

```bash
pa schedule daily:plan daily 05:00       # Daily plan at 05:00
pa schedule daily:progress daily 14:00  # Progress check at 14:00
pa schedule daily:end daily 21:00       # End-of-day at 21:00
pa schedule maintenance weekly 09:00    # Weekly maintenance at 09:00
```

---

## `pa timers`

List all active `pa-*` systemd user timers.

**Synopsis:** `pa timers`

**Description:**

Runs `systemctl --user list-timers 'pa-*'` to show all scheduled `pa` timers, their next trigger time, and last trigger time.

**Examples:**

```bash
pa timers
```

---

## `pa remove-timer <name>`

Stop and remove a scheduled timer.

**Synopsis:** `pa remove-timer <name>`

**Description:**

Stops the timer, disables it, deletes both the `.timer` and `.service` unit files, and reloads the systemd daemon.

**Arguments:**

| Argument | Type | Description |
|----------|------|-------------|
| `name` | string (required) | Timer name (the part after `pa-`, e.g. `daily-plan` removes `pa-daily-plan.timer`) |

**Examples:**

```bash
pa remove-timer daily-plan       # Removes pa-daily-plan.timer + .service
pa remove-timer maintenance      # Removes pa-maintenance.timer + .service
```

---

## `pa requirements <mode> [options]`

Requirements lifecycle — triage idea files into structured tickets.

**Synopsis:** `pa requirements <mode> [options]`

**Description:**

Deploys the requirements team to process pending idea files in `~/Documents/ai-usage/sinh-inputs/ideas/`. Currently supports one mode: `ideas`.

**Arguments:**

| Argument | Type | Description |
|----------|------|-------------|
| `mode` | string (required) | `ideas` — triage idea files |

**Options:**

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--force` | boolean | false | Re-triage all ideas, not just new ones |
| `--dry-run` | boolean | false | Generate and print the primer without running claude |
| `--background` | boolean | false | Run in background (default) |
| `--interactive` | boolean | false | Run in foreground, user approves each tool call |

**Examples:**

```bash
pa requirements ideas                  # Triage new idea files
pa requirements ideas --force          # Re-triage all ideas
pa requirements ideas --dry-run        # Preview without executing
```

---

## `pa idea`

Interactively log an idea.

**Synopsis:** `pa idea`

**Description:**

Prompts for a title and description, generates a slug, and saves as a markdown file to `~/Documents/ai-usage/sinh-inputs/ideas/<date>-<slug>.md`. The idea is picked up by `pa requirements ideas` during the next triage run.

**Examples:**

```bash
pa idea
```

---

## `pa report`

Submit a bug report, feature request, agent self-report, or feedback.

**Synopsis:** `pa report`

**Description:**

Interactive prompt — select a report type (`bug`, `feature`, `agent`, `feedback`), fill in the fields, and the report is saved as a markdown file to `~/Documents/ai-usage/sinh-inputs/reports/`.

**Examples:**

```bash
pa report
```

---

## `pa repos <subcommand>`

Manage the repository registry.

**Synopsis:** `pa repos <subcommand>`

**Description:**

Query the `repos.yaml` registry that maps project keys to local repository paths. Used by other commands for `--project` flag resolution.

**Subcommands:**

| Subcommand | Description |
|-----------|-------------|
| `list` | List all configured repository names, paths, and descriptions |

**Examples:**

```bash
pa repos list                    # Show all configured repos and their keys
```

---

## `pa serve [options]`

Start the agent API server.

**Synopsis:** `pa serve [options]`

**Description:**

Starts a Hono-based HTTP + WebSocket server that exposes agent-facing REST API endpoints (tickets, board, bulletins, repos, etc.). Used by agents to communicate with the PA system programmatically.

Default port: `9848`. Default host: `0.0.0.0`.

**Options:**

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--port <number>` | number | `9848` | Port to listen on |
| `--host <address>` | string | `0.0.0.0` | Host address to bind to |
| `--background` | boolean | false | Run in background mode (writes PID to `~/.local/share/personal-assistant/pa-serve.pid`) |
| `--cors` | boolean | false | Enable CORS headers |

**Examples:**

```bash
pa serve                          # Start on 0.0.0.0:9848
pa serve --port 8080              # Custom port
pa serve --background --cors      # Background with CORS enabled
```

---

## `pa ticket <subcommand> [options]`

Manage tickets.

**Synopsis:** `pa ticket <subcommand> [options]`

**Description:**

Full lifecycle ticket management. Tickets are stored in `~/.local/share/personal-assistant/tickets/` and indexed by project key.

### `pa ticket create`

Create a new ticket.

| Flag | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `--project <name>` | string | ✓ | — | Project key from repos.yaml (e.g. `pa`, `avodah`) |
| `--title <title>` | string | ✓ | — | Ticket title |
| `--type <type>` | string | ✓ | — | `feature\|bug\|task\|review-request\|work-report\|fyi\|idea\|question` |
| `--priority <priority>` | string | ✓ | — | `critical\|high\|medium\|low` |
| `--estimate <size>` | string | ✓ | — | `XS\|S\|M\|L\|XL` |
| `--assignee <name>` | string | ✓ | — | Assignee (team or person name) |
| `--summary <text>` | string | — | `""` | Short summary (supports template fields per type) |
| `--tags <tags>` | string | — | `""` | Comma-separated tags |
| `--doc-ref <path>` | string | — | `""` | Reference path (relative to `~/Documents/ai-usage/`) |
| `--from <team>` | string | — | `""` | Originating team |
| `--to <team>` | string | — | `""` | Destination team |
| `--actor <name>` | string | — | `cli-user` | Actor for audit log |

### `pa ticket update <id>`

Update fields on an existing ticket.

| Flag | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `--status <status>` | string | — | — | New status (see Enum Values below) |
| `--assignee <name>` | string | — | — | New assignee |
| `--priority <priority>` | string | — | — | New priority |
| `--tags <tags>` | string | — | — | Comma-separated tags (replaces all existing tags) |
| `--blocked-by <ids>` | string | — | — | Comma-separated ticket IDs blocking this ticket (empty string to clear) |
| `--estimate <size>` | string | — | — | New effort estimate |
| `--doc-ref <path>` | string | — | — | Document reference path |
| `--actor <name>` | string | — | `cli-user` | Actor for audit log |

### `pa ticket list`

List tickets with optional filters.

| Flag | Type | Description |
|------|------|-------------|
| `--project <name>` | string | Filter by project key |
| `--status <status>` | string | Filter by status |
| `--assignee <name>` | string | Filter by assignee |
| `--priority <priority>` | string | Filter by priority |
| `--type <type>` | string | Filter by ticket type |

### `pa ticket show <id>`

Show full ticket details as JSON.

### `pa ticket attach <id>`

Attach a file or doc-ref to a ticket.

| Flag | Type | Required | Description |
|------|------|----------|-------------|
| `--file <path>` | string | ✓ | File path or doc-ref to attach |
| `--actor <name>` | string | — | Actor for audit log (default: `cli-user`) |

### `pa ticket comment <id>`

Add a comment to a ticket.

| Flag | Type | Required | Description |
|------|------|----------|-------------|
| `--author <name>` | string | ✓ | Comment author (format: `team/agent` or `sinh`) |
| `--content <text>` | string | ✓ | Comment text |

**Examples:**

```bash
pa ticket create --project pa --title "Fix login" --type bug \
  --priority high --estimate S --assignee builder \
  --summary "WHAT: Login fails on expired token. EXPECTED: Redirect. REPRO: login with old token. SEVERITY: high"

pa ticket update PA-042 --status implementing --assignee team-manager
pa ticket update PA-042 --status review-uat --assignee sinh --doc-ref "agent-teams/builder/artifacts/2026-03-23-login-fix.md"
pa ticket update PA-042 --tags "blocked" && pa ticket comment PA-042 --author builder --content "BLOCKED: waiting on PA-040"

pa ticket list --assignee builder --status pending-implementation
pa ticket list --project pa --priority high

pa ticket show PA-042
pa ticket comment PA-042 --author team-manager --content "Phase 1 complete: created API handler. Session log: sessions/2026/03/agent-team/2026-03-23-abc123-builder--team-manager--PA-042--login-fix.md"
```

---

## `pa bulletin <subcommand> [options]`

Manage bulletins (deploy-time blockers).

**Synopsis:** `pa bulletin <subcommand> [options]`

**Description:**

Bulletins are system-wide or team-scoped block signals that prevent agent deployments from proceeding. Agents check `pa bulletin list` on startup and abort if a blocking bulletin is active.

### `pa bulletin create`

Create a new active bulletin.

| Flag | Type | Required | Description |
|------|------|----------|-------------|
| `--title <title>` | string | ✓ | Bulletin title |
| `--block <teams>` | string | ✓ | Teams to block: `"all"` or comma-separated team names (e.g. `"daily,builder"`) |
| `--except <teams>` | string | — | Comma-separated list of teams exempt from this bulletin (default: none) |
| `--message <text>` | string | — | Bulletin body message (default: `""`) |

### `pa bulletin list`

List all active (unresolved) bulletins.

### `pa bulletin resolve <id>`

Deactivate a bulletin by ID.

| Argument | Type | Description |
|----------|------|-------------|
| `id` | string (required) | Bulletin ID (e.g. `B-001`) |

**Examples:**

```bash
pa bulletin create --title "Freeze: UAT in progress" --block all
pa bulletin create --title "Freeze: deploy paused" --block "builder,orchestrator" --except maintenance --message "Deploying to production — builder/orchestrator paused until done"

pa bulletin list
pa bulletin resolve B-001
```

---

## Project Keys

The `--project` flag (and related ticket ID prefixes) uses canonical project keys defined in `repos.yaml`.

### Resolution Order

When you pass a value to `--project`, the system resolves it in this order:

1. **Exact key** — e.g., `pa`, `avodah`, `ai-usage-log`
2. **Prefix match (case-insensitive)** — e.g., `PA`, `AVO`, `AUL`
3. **Path basename** — e.g., `personal-assistant` resolves to `pa`

### Configured Keys

| Key | Ticket Prefix | Repository |
|-----|--------------|-----------|
| `pa` | `PA-` | personal-assistant |
| `avodah` | `AVO-` | avodah |
| `ai-usage-log` | `AUL-` | ai-usage-log |
| `nixos` | `NX-` | personal-nixos |
| `dot-files` | `DOT-` | dot-files |

Run `pa repos list` to see all configured project keys with paths.

### Practical Rules

- Always use the canonical short key: `pa` not `personal-assistant`
- Ticket IDs use the project prefix: `PA-042`, `AVO-007`
- The `--repo` flag on `pa deploy` also accepts repo names from repos.yaml

---

## Enum Values

### `--status`

```
idea  requirement-review  pending-approval  pending-implementation
implementing  review-uat  done  rejected  cancelled
```

### `--type`

```
feature  bug  task  review-request  work-report  fyi  idea  question
```

### `--priority`

```
critical  high  medium  low
```

### `--estimate`

```
XS  S  M  L  XL
```
