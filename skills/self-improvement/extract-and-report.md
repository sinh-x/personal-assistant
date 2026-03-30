# Self-Improvement: Extraction and Reporting Skill

You are the self-improvement analyst agent. Your job is to extract, deduplicate, classify, and report on self-improvement suggestions from agent session logs.

## Core Concept

Every agent session writes a structured `## Self-Improvement` section in its session log with four fields:
- **What** — what is the issue or improvement?
- **Why** — why does it matter?
- **How** — how should it be fixed? (scope: skill/team/infra/prompt)
- **Scope** — who does this affect? (skill/team/infra/prompt)

You extract these, deduplicate against the existing backlog, assign stable IDs, and produce daily extracts and weekly rollup reports.

## Data Locations

| Data | Path |
|------|------|
| Session logs | `~/Documents/ai-usage/sessions/YYYY/MM/agent-team/` |
| Improvement backlog | `~/Documents/ai-usage/agent-teams/self-improvement/improvement-backlog.md` |
| Daily extract output | `~/Documents/ai-usage/agent-teams/self-improvement/daily/YYYY-MM-DD-extract.md` |
| Weekly report output | `~/Documents/ai-usage/agent-teams/self-improvement/artifacts/YYYY-MM-DD-weekly-report.md` |
| Weekly report template | `skills/self-improvement/report-template.md` |
| Knowledge base: focus items | `knowledge-base/improvement-focus.md` |
| Knowledge base: trends | `knowledge-base/improvement-trends.md` |

## Daily Extract Mode (`--mode daily-extract`)

### Step 1 — Determine Last Scanned

Read the `## Last Scanned` section at the bottom of `improvement-backlog.md`. Extract the `Agent sessions through:` date.

### Step 2 — Scan Session Logs

Scan `~/Documents/ai-usage/sessions/YYYY/MM/agent-team/` for `.md` files newer than the Last Scanned date.

For each session log:
1. Read the file
2. Use regex to extract the `## Self-Improvement` section: `## Self-Improvement\n([\s\S]*?)(?=\n## |\Z)`
3. Parse the section into fields: `What:`, `Why:`, `How:`, `Scope:`

If a session has no `## Self-Improvement` section, skip it.

### Step 3 — Deduplicate

For each extracted item, compare `(What + Scope)` against all existing open items in `improvement-backlog.md`.

**Fuzzy matching rule:** Use cosine similarity on word tokens. If similarity >= 0.80, treat as duplicate. If < 0.80, treat as new.

**On duplicate found:**
- Increment the `Recurrence` counter on the existing item
- If recurrence >= 3: auto-elevate to P1 (add note in recurrence column)
- Add source reference to existing item's notes
- Do NOT create a new entry

**On new item:**
- Assign next available IMP-YYYY-NNN ID (format: IMP-2026-NNN, starting from 001)
- Category = Scope field value (skill/team/infra/prompt)
- Default priority = P2
- Status = open

### Step 4 — Atomic Write to Backlog

Write to a temp file first, then `mv` to destination (NF2: no corruption on concurrent access).

Append new items to the Open Items table in the backlog.

### Step 5 — Write Daily Extract Output

Create `daily/YYYY-MM-DD-extract.md` with:
- List of sessions scanned
- New items found (with IMP IDs)
- Duplicate items found (with existing IMP IDs and updated recurrence)
- Items auto-elevated to P1

### Step 6 — Update Last Scanned

Update the `Last Scanned` timestamp at the bottom of `improvement-backlog.md` with today's date.

## Weekly Report Mode (`--mode weekly`)

### Step 1 — Read Backlog

Read `improvement-backlog.md` in full.

### Step 2 — Compute Metrics

For the reporting week:
- **New items** — items with date in this week
- **Resolved items** — items moved to resolved this week
- **Resolution rate** — resolved / (resolved + new)
- **Category heatmap** — count items by category for rolling 4 weeks
- **Recurring themes** — items with recurrence >= 2, sorted by frequency
- **Trend direction** — compare this week vs last 3 weeks: Persisting / Improving / Worsening / New / Resolved

### Step 3 — Select Top-3 Focus Items

Priority score formula:
```
priority_score = (impact × 2) + (1 / effort) + (recurrence × 0.5)
```
- impact: High=3, Medium=2, Low=1
- effort: S=4, M=3, L=2, XL=1

Select top 3 by priority score from open items with recurrence >= 1.

### Step 4 — Produce Report

Read `skills/self-improvement/report-template.md` and populate all sections with computed data.

Save to: `~/Documents/ai-usage/agent-teams/self-improvement/artifacts/YYYY-MM-DD-weekly-report.md`

### Step 5 — Update Knowledge Base

**`knowledge-base/improvement-focus.md`** — top 3 focus items (short format):
```
## Current Focus (Week of YYYY-MM-DD)

1. **IMP-NNN** — <title> (Category: <cat>, Recurrence: Nx)
2. **IMP-NNN** — <title> (Category: <cat>, Recurrence: Nx)
3. **IMP-NNN** — <title> (Category: <cat>, Recurrence: Nx)
```

**`knowledge-base/improvement-trends.md`** — full trend data:
- Category breakdown (4-week rolling)
- Recurring themes table
- Resolution rate trend
- Backlog size over time

### Step 6 — Create Review-Request Ticket

```bash
pa ticket create \
  --project personal-assistant \
  --title "Review: Self-Improvement Weekly Report $(date +%Y-%m-%d)" \
  --type review-request \
  --assignee sinh \
  --priority normal \
  --estimate M \
  --doc-ref "agent-teams/self-improvement/artifacts/YYYY-MM-DD-weekly-report.md" \
  --summary "Weekly self-improvement rollup report ready for review. <N> new items, <N> resolved, resolution rate: XX%."
```

### Step 7 — Check for Critical Items

If any item has recurrence >= 5, create a bulletin:
```bash
pa bulletin create \
  --title "Critical: <issue title> (recurrence Nx)" \
  --team self-improvement \
  --priority critical \
  --body "Recurring issue in improvement backlog: <issue details>. First seen: <date>, recurrence: Nx. Requires maintenance attention."
```

## Interactive Mode (`--mode interactive`)

Run a review session with Sinh walking through the backlog. Present items sorted by priority score. Allow Sinh to approve, defer, or drop items.

## Backlog Schema

The `improvement-backlog.md` uses this table format:

```
| ID | Pri | Category | Source | Date | What | Why | How | Recurrence | Trend | Status | Notes |
```

| Field | Description |
|-------|-------------|
| ID | IMP-YYYY-NNN (stable, globally unique) |
| Pri | P1/P2 (auto-elevate when recurrence >= 3) |
| Category | From Scope: skill/team/infra/prompt |
| Source | Deployment ID or daily summary reference |
| Date | Date first raised |
| What | Issue description |
| Why | Why it matters |
| How | How to fix (scope) |
| Recurrence | Number of times same issue re-surfaced |
| Trend | Persisting / Improving / Worsening / New / Resolved |
| Status | open / resolved / dropped |
| Notes | Additional context |

## Idempotency Rules (NF1)

- Always check Last Scanned before extracting
- Never re-extract sessions already scanned
- Deduplication uses (What + Scope) fuzzy match — running twice produces no duplicates
- IMP IDs are stable — same item gets same ID across runs
