# PA CLI Reference — Agent Quick Reference

All agents have access to the `pa` CLI. Use these commands for ticket management,
deployment, and system operations.

## Commands

| Command | Purpose | Key Flags |
|---------|---------|-----------|
| `pa teams [name]` | Show team workflow status; detail with name | — |
| `pa board` | Show kanban board grouped by status | `--project`, `--assignee` |
| `pa deploy <team>` | Deploy an agent team | `--objective`, `--mode`, `--dry-run`, `--background`, `--interactive`, `--direct`, `--ticket`, `--repo`, `--team-model`, `--agent-model` |
| `pa daily <mode>` | Daily lifecycle: plan / progress / end | `--dry-run`, `--background`, `--interactive`, `--review` |
| `pa status [id]` | Show deployment status | `--running`, `--team`, `--wait`, `--report`, `--artifacts`, `--activity` |
| `pa schedule <spec> <repeat> [times]` | Schedule a team with systemd timers | — |
| `pa timers` | List scheduled timers | — |
| `pa remove-timer <name>` | Remove a scheduled timer | — |
| `pa requirements <mode>` | Requirements lifecycle (ideas) | `--force`, `--dry-run`, `--background`, `--interactive` |
| `pa idea` | Log an idea interactively | — |
| `pa report` | Submit a bug/feature/agent self-report | — |
| `pa repos list` | List repository registry | — |
| `pa serve` | Start the agent API server | `--port`, `--host`, `--background`, `--cors` |
| `pa ticket <sub>` | Manage tickets (see §Ticket) | — |
| `pa bulletin <sub>` | Manage bulletins (see §Bulletin) | — |

## Ticket Subcommands

| Subcommand | Purpose | Key Flags |
|-----------|---------|-----------|
| `ticket create` | Create a ticket | `--project`* `--title`* `--type`* `--priority`* `--estimate`* `--assignee`* `--summary` `--doc-ref` `--tags` |
| `ticket update <id>` | Update ticket fields | `--status` `--assignee` `--priority` `--tags` `--blocked-by` `--doc-ref` `--doc-ref-primary` `--remove-doc-ref` `--estimate` |
| `ticket list` | List/filter tickets | `--project` `--status` `--assignee` `--priority` `--type` |
| `ticket show <id>` | Show full ticket details | — |
| `ticket attach <id>` | Attach a file as doc_ref (type: attachment) | `--file`* |
| `ticket comment <id>` | Add a comment | `--author`* `--content`* |

## Bulletin Subcommands

| Subcommand | Purpose | Key Flags |
|-----------|---------|-----------|
| `bulletin create` | Create a blocking bulletin | `--title`* `--block`* (all/team-names) `--except` `--message` |
| `bulletin list` | List active bulletins | — |
| `bulletin resolve <id>` | Deactivate a bulletin | — |

## Enum Values

| Flag | Values |
|------|--------|
| `--status` | `idea` `requirement-review` `pending-approval` `pending-implementation` `implementing` `review-uat` `done` `rejected` `cancelled` |
| `--type` | `feature` `bug` `task` `review-request` `work-report` `fyi` `idea` `question` |
| `--priority` | `critical` `high` `medium` `low` |
| `--estimate` | `XS` `S` `M` `L` `XL` |

## Project Keys

The `--project` flag accepts canonical keys from `repos.yaml`. Resolution order:
1. **Exact key** — e.g., `pa`, `avodah`, `ai-usage-log`
2. **Prefix match** — e.g., `PA`, `AVO`, `AUL` (case-insensitive)
3. **Path basename** — e.g., `personal-assistant`, `avodah`

Common keys: `pa` (PA·), `avodah` (AVO·), `ai-usage-log` (AUL·), `nixos` (NX·), `dot-files` (DOT·)

Run `pa repos list` to see all configured project keys.

`*` Required flag
