# Skill: Sprint-Master — Velocity Mode

You are the sprint-master team manager running in **velocity** mode. Your job is to compute
and report sprint velocity metrics derived from the ticket audit log. This produces a
weekly throughput and estimation accuracy report for trend analysis.

## Objectives

1. Compute throughput for the current and previous weeks
2. Calculate estimation accuracy (predicted vs actual cycle time)
3. Track blocked time trends
4. Produce a velocity report

## Workflow

### Step 1 — Gather metrics from the ticket system

Use the PA metrics CLI:
```bash
pa ticket metrics --project personal-assistant
pa ticket metrics --project personal-nixos
```

The metrics command reads `~/Documents/ai-usage/tickets/audit.jsonl` and computes:
- **Throughput** — tickets completed per week
- **Cycle time** — average time from `implementing` to `review-uat` or `done` (in hours)
- **Blocked time** — total time spent with `blocked` tag after first `implementing` transition
- **Estimation accuracy** — estimate size vs actual cycle time (within one band = accurate)
- **Carry-over rate** — tickets not resolved in their first active sprint window

### Step 2 — Parse metric outputs

For each project, record:

```
Project: personal-assistant
  This week (YYYY-MM-DD – YYYY-MM-DD):
    Throughput: N tickets completed
    Average cycle time: X.X hours
    Average blocked time: X.X hours
    Estimation accuracy: XX% (N of M tickets within one band)
    Carry-over: K tickets (XX%)

  Last week:
    Throughput: M tickets
    Average cycle time: Y.Y hours
    ...
```

### Step 3 — Compute trends

Compare current week to previous week:

| Metric | Last Week | This Week | Trend |
|--------|-----------|-----------|-------|
| Throughput | M | N | ↑/↓/→ |
| Avg cycle time | Y.Y hr | X.X hr | ↑/↓/→ |
| Blocked time | B.B hr | A.A hr | ↑/↓/→ |
| Estimation accuracy | YY% | XX% | ↑/↓/→ |
| Carry-over | YK | XK | ↑/↓/→ |

Trend arrows: ↑ improving, ↓ degrading, → stable (within 10% change)

### Step 4 — Estimation accuracy analysis

For each estimate size band, compute how often actual cycle time aligned:

| Estimate | Expected Duration | Tickets | Accurate | Over | Under |
|----------|------------------|---------|---------|------|-------|
| XS | < 0.5h | N | A | B | C |
| S | 0.5-2h | N | A | B | C |
| M | 2-4h | N | A | B | C |
| L | 4-8h | N | A | B | C |
| XL | > 8h | N | A | B | C |

Accurate = actual time within ±50% of expected band
Over = actual time exceeded band (underestimated)
Under = actual time below band (overestimated)

Identify which teams consistently over- or under-estimate, and note in the report.

### Step 5 — Identify velocity blockers

Scan for tickets with high blocked time:
```bash
pa ticket list --status implementing
pa ticket list --status review-uat
```

Tickets that have been in these statuses for >48h are potential velocity blockers.

For each blocker:
- Note the ticket, team, how long it's been stuck
- Check if there are comments explaining the block
- Flag for Sinh if no clear resolution path

### Step 6 — Write velocity report

Save to team artifacts:
```
~/Documents/ai-usage/agent-teams/sprint-master/artifacts/YYYY-MM-DD-velocity-report.md
```

Report format:
```markdown
# Velocity Report: Week of YYYY-MM-DD

> **Period:** YYYY-MM-DD to YYYY-MM-DD
> **Generated:** YYYY-MM-DD HH:MM
> **By:** sprint-master / team-manager

## Summary

| Metric | Last Week | This Week | Trend |
|--------|-----------|-----------|-------|
| Throughput | M | N | ↑ |
| Avg cycle time | Y.Yh | X.Xh | ↓ |
| Blocked time | B.Bh | A.Ah | → |
| Estimation accuracy | YY% | XX% | ↑ |
| Carry-over | YK | XK | ↓ |

## Throughput Breakdown

| Team | Tickets Completed | Tickets Failed | Carry-over |
|------|------------------|----------------|------------|
| builder | N | M | K |
| requirements | N | M | K |
| sprint-master | N | M | K |

## Estimation Accuracy

| Estimate | Tickets | Accurate | Over | Under |
|----------|---------|---------|------|-------|
| XS | N | A | B | C |
| ...

## Active Blockers

| Ticket | Team | Status | Stuck Since | Description |
|--------|------|--------|-------------|-------------|
| PA-010 | builder | doing | YYYY-MM-DD | ... |

## Recommendations

- <actionable recommendation based on data — e.g., "builder consistently underestimates M tickets — consider sizing up">
- <or "None — velocity is healthy">
```

### Step 7 — Write work report

Write to `~/Documents/ai-usage/sinh-inputs/inbox/`:
```
YYYY-MM-DD-sprint-master-velocity.md
```

Include a link to the velocity report artifact and a brief summary of key findings.

## Rules

- If audit.jsonl is empty or project has <5 tickets, note data is insufficient for meaningful trends
- Always compare to the previous period — absolute numbers alone are not useful
- Do not recommend changes to team assignments or skills — that is Sinh's decision
- Produce the best analysis possible with available data — note any gaps
- Log session per global standards
