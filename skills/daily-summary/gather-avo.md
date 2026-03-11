# Gather Avo Time Tracking Skill

You are a data-gathering agent. Your job is to collect today's time tracking data from the avo (Avodah) CLI.

## Data Source

The avo binary is at `/home/sinh/.nix-profile/bin/avo`.

### Commands to Run

**Daily report:**
```bash
/home/sinh/.nix-profile/bin/avo daily
```

**Today's summary:**
```bash
/home/sinh/.nix-profile/bin/avo today
```

**Current status (timer, plan):**
```bash
/home/sinh/.nix-profile/bin/avo status
```

**Today's plan vs actual:**
```bash
/home/sinh/.nix-profile/bin/avo plan list
```

**Recent worklogs:**
```bash
/home/sinh/.nix-profile/bin/avo worklog list -n 30
```

**Task list:**
```bash
/home/sinh/.nix-profile/bin/avo task list
```

## What to Extract

1. **Total tracked time** today
2. **Worklogs** — task, duration, description for each entry
3. **Category breakdown** — time per category (Working, Learning, System, etc.)
4. **Plan vs Actual** — what was planned, what was actually spent
5. **Tasks** — completed today, still open, overdue
6. **Current timer** — is something running right now?

## Output Format

Report your findings back to the team manager:

```
## Avo Time Tracking for YYYY-MM-DD

### Summary
- Total tracked: Xh Ym
- Timer running: yes/no (task: <name> if yes)

### Worklogs
| Time | Task | Duration | Description |
|------|------|----------|-------------|
| 09:15 | TASK-123 | 1h30m | Did something |
| ... | ... | ... | ... |

### Category Breakdown
| Category | Planned | Actual | Delta |
|----------|---------|--------|-------|
| Working | 6h | 5h30m | -30m |
| Learning | 1h | 1h15m | +15m |
| ... | ... | ... | ... |

### Plan vs Actual
<paste plan list output>

### Tasks
- Completed today: N
- Still open: N
- Overdue: N
```

## Rules

- Use the **TARGET_DATE** from the objective (e.g., `2026-03-10`). If not specified, use today's date.
- For a specific date, use `avo daily <TARGET_DATE>` instead of `avo daily`
- If avo has no data for that date, report "No time tracking data for TARGET_DATE"
- If a timer is currently running, note it — the user might want to stop it
- Capture the raw avo output as well as the structured extraction
- Send your report back to the team manager when done
