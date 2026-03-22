# Commands Reference

## `pa teams`

List all available teams.

```bash
pa teams
```

Output shows team name, description, and source (`[user]` for PA_CONFIG overrides, `[builtin]` for PA_HOME).

---

## `pa deploy <team> [options]`

Deploy an agent team.

```bash
pa deploy maintenance                    # Background (default)
pa deploy maintenance --dry-run          # Print primer, don't execute
pa deploy maintenance --foreground       # Run with auto-permissions
pa deploy maintenance --interactive      # Run with manual approval
pa deploy builder --objective "Fix X"    # Append extra instructions
```

**Options:**

| Flag | Description |
|---|---|
| `--dry-run` | Generate and print the primer without running claude |
| `--foreground` | Run claude in foreground with `--dangerously-skip-permissions` |
| `--interactive` | Run claude in foreground, user approves each tool call |
| `--objective <text>` | Append additional instructions to the team objective |

**Environment:**

| Variable | Effect |
|---|---|
| `PA_MAX_RUNTIME` | Override timeout (default: 1800s). Example: `PA_MAX_RUNTIME=3600 pa deploy builder` |

---

## `pa daily <mode> [date] [options]`

Run the daily lifecycle workflow.

```bash
pa daily plan                     # Morning plan (today)
pa daily progress                 # Mid-day check
pa daily end                      # End-of-day summary
pa daily plan 2026-03-15          # Plan for a specific date
pa daily plan --dry-run           # Preview the primer
pa daily plan --foreground        # Run interactively
```

**Modes:**

| Mode | Typical Time | Output |
|---|---|---|
| `plan` | 05:00 | `sinh-inputs/inbox/<date>-plan-draft.md` |
| `progress` | 14:00 | `daily/<year>/<month>/<date>-progress.md` |
| `end` | 21:00 | `daily/<year>/<month>/<date>-daily.md` |

---

## `pa status [deploy-id] [options]`

Show deployment status.

```bash
pa status                    # All recent deployments (table)
pa status --running          # Only running deployments
pa status --team maintenance # Filter by team name
pa status d-7ae0a9           # Detail view for specific deployment
```

**Status indicators:**

| Symbol | Meaning |
|---|---|
| `[>>]` | Running (PID alive) |
| `[OK]` | Completed successfully |
| `[!!]` | Crashed or failed |
| `[??]` | Dead (PID gone, no completion event) |

---

## `pa schedule <spec> <repeat> [times...]`

Create a systemd user timer.

```bash
pa schedule daily:plan daily 05:00          # Daily plan at 05:00
pa schedule daily:progress daily 14:00      # Progress check at 14:00
pa schedule daily:end daily 21:00           # End-of-day at 21:00
pa schedule maintenance weekly 09:00        # Weekly health check
```

**Spec formats:**
- `daily:<mode>` — wraps `pa daily <mode>`
- `<team-name>` — wraps `pa deploy <team>`

**Repeat options:** `hourly`, `daily`, `weekly`, `monthly`

---

## `pa timers`

List all active `pa-*` systemd user timers.

```bash
pa timers
```

Runs `systemctl --user list-timers 'pa-*'`.

---

## `pa remove-timer <name>`

Stop and remove a scheduled timer.

```bash
pa remove-timer daily-plan       # Removes pa-daily-plan.timer + .service
pa remove-timer maintenance      # Removes pa-maintenance.timer + .service
```

Stops the timer, disables it, deletes the unit files, and reloads the daemon.

---

## `pa idea`

Interactively log an idea.

```bash
pa idea
```

Prompts for title and description, generates a slug, and saves as a markdown file to `~/Documents/ai-usage/sinh-inputs/ideas/<date>-<slug>.md`.
