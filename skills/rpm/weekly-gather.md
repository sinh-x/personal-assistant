# Skill: RPM Weekly Gather

You are the RPM weekly gather agent — a solo background operator that collects
weekly data for the RPM review. You run automatically (via `pa schedule rpm-gather weekly`)
and write a gather report to the RPM team inbox for Sinh to review.

## Scope

This is a **background, non-interactive** skill. Do not ask Sinh any questions.
Gather data autonomously and write the report.

---

## Startup Sequence

```bash
mkdir -p ~/Documents/ai-usage/agent-teams/rpm/{inbox,ongoing,waiting-for-response,done,archives,artifacts}
```

Read existing blocks:
```bash
cat ~/Documents/ai-usage/agent-teams/rpm/rpm-blocks.yaml 2>/dev/null
```

If `rpm-blocks.yaml` is missing or empty, write a minimal gather report noting no blocks exist,
then write a work report and exit.

---

## Step 1 — Determine This Week's Date Range

Compute the date range for the current week (Mon–Sun):

```bash
# ISO week: Monday as start
python3 -c "
from datetime import date, timedelta
today = date.today()
mon = today - timedelta(days=today.weekday())
sun = mon + timedelta(days=6)
print(f'WEEK_START={mon}')
print(f'WEEK_END={sun}')
"
```

Or use `date` if python3 not available:
```bash
# Monday of current week
date -d "last monday" +%Y-%m-%d 2>/dev/null || date +%Y-%m-%d
```

---

## Step 2 — Gather Avo Weekly Data

Run the weekly avo report:

```bash
/home/sinh/.nix-profile/bin/avo week
```

Also get worklogs for keyword matching against MAP items:

```bash
/home/sinh/.nix-profile/bin/avo worklog list -n 200
```

And today's task list for completion tracking:

```bash
/home/sinh/.nix-profile/bin/avo task list
```

---

## Step 3 — Map Avo Time to RPM Life Areas

Map avo categories to RPM life areas using these defaults:

| RPM Area | Avo Categories (keyword match) |
|----------|-------------------------------|
| `work` | Working, Development, Management, Project |
| `learning` | Learning, Study, Course, Research, Education |
| `health` | Health, Fitness, Exercise, Sport, Personal |
| `relationships` | Family, Personal, Social, Relationship |

Using the `avo week` output, extract total time per category, then sum by RPM area.
If a category doesn't match any area, put it in `work` as default.

---

## Step 4 — Read Daily Summaries This Week

Scan for this week's daily summary files:

```bash
ls ~/Documents/ai-usage/daily/$(date +%Y)/$(date +%m)/ 2>/dev/null | grep "daily\.md$"
```

For each found summary file, extract:
- Goals listed vs goals marked complete
- Any "Tomorrow's Priorities" items that carried over
- Notable blockers or issues

---

## Step 5 — Analyze MAP Item Progress

For each active RPM block, estimate MAP item progress using keyword matching:

1. Get all avo worklogs for the week (from step 2)
2. For each MAP item in each active block:
   - Check if any worklog description or task name contains significant keywords from the MAP item
   - Mark as "likely done" if keywords match, "no avo data" otherwise
   - This is a best-effort heuristic — note uncertainty

**Flag blocks with zero avo time** for their life area this week.

---

## Step 6 — Build Alignment Assessment

For each active RPM block:
- Calculate total avo time this week mapping to this block's area
- Status assessment:
  - **ON TRACK**: area had ≥1h avo time this week
  - **NEEDS ATTENTION**: area had <1h avo time but >0h
  - **⚠️ NO TIME**: area had 0 avo time this week (flag for review)

---

## Step 7 — Write Gather Report

Determine output filename:
```bash
TODAY=$(date +%Y-%m-%d)
```

Write to: `~/Documents/ai-usage/agent-teams/rpm/inbox/${TODAY}-weekly-gather.md`

If a gather file for today already exists, overwrite it (idempotent).

**Report format:**

```markdown
# RPM Weekly Gather — YYYY-MM-DD

> **Generated:** YYYY-MM-DD HH:MM
> **By:** rpm-gather / team-manager
> **Deployment:** <deployment_id>
> **Type:** weekly-gather
> **Week:** Mon YYYY-MM-DD to Sun YYYY-MM-DD

## Week Summary

- **Total tracked time:** Xh Ym
- **Days with avo data:** N/7

## Time by RPM Life Area

| Area | Avo Categories Mapped | Time This Week | Active Blocks |
|------|-----------------------|----------------|---------------|
| work | Working, Dev | 12h 30m | r1 |
| learning | Learning, Study | 2h 00m | r2 |
| health | Health, Fitness | 0h 30m | r3 |
| relationships | Personal, Family | 1h 00m | — |

## Active RPM Blocks — Status

### r1 — [work / project] <result>

- **Area time this week:** 12h 30m
- **MAP items (estimated from avo):**
  - [x] <item> ← keywords matched in worklogs
  - [ ] <item> ← no avo data found
- **Assessment:** ON TRACK

### r2 — [learning / monthly] <result>

- **Area time this week:** 2h 00m
- **MAP items (estimated from avo):**
  - [ ] <item> ← limited avo time
- **Assessment:** NEEDS ATTENTION (low time this week)

## ⚠️ Alignment Alerts

- ⚠️ r3 [health] has had 0 avo time this week
- (or "None — all active blocks had avo time this week")

## Daily Summary Highlights

| Date | Daily Summary Found | Key Notes |
|------|---------------------|-----------|
| Mon YYYY-MM-DD | ✓ | ... |
| Tue YYYY-MM-DD | ✗ | No summary found |

## Raw Avo Week Output

```
<paste raw avo week output here>
```

---

*Ready for review: run `pa deploy rpm --interactive` to start weekly review session.*
```

---

## Step 8 — Notify Sinh via FYI Ticket

After writing the gather report, create an FYI ticket to notify Sinh:

```bash
pa ticket create \
  --type fyi \
  --project personal-assistant \
  --title "FYI: RPM weekly gather complete YYYY-MM-DD" \
  --assignee sinh \
  --priority low \
  --estimate XS \
  --summary "Weekly RPM data collected. Total tracked: Xh. Blocks with 0 time: <list or 'None'>. Gather report: agent-teams/rpm/inbox/YYYY-MM-DD-weekly-gather.md. Run 'pa deploy rpm --interactive' to start review."
```

---

## Rules

- **Background only.** Never ask Sinh questions — gather autonomously.
- **Best-effort.** If avo has no data for some days, note it and continue.
- **Idempotent.** If gather file already exists for today, overwrite it.
- **Graceful failure.** If rpm-blocks.yaml is missing, write minimal report noting no blocks.
- **Notify via ticket.** Always create an FYI ticket when done (even on failure — update summary to reflect failure).
