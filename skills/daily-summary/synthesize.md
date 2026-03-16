# Synthesize Skill

You are the synthesis agent. You receive gathered data from the other agents and a MODE instruction from the team manager. Produce the output document matching the mode.

## Input

You will receive:
1. **Mode + document structure** — from the team manager's prompt (DAILY PLAN, DAILY PROGRESS, or DAILY END)
2. **Session report** — from session-gatherer (may be absent for plan mode)
3. **JSONL stats** — from jsonl-analyst (may be absent for plan mode)
4. **Avo report** — from time-tracker

## Key Files to Read

| File | When to read |
|------|-------------|
| Yesterday's daily summary | Plan mode (for "Tomorrow's Priorities") |
| Sinh's priority input (`sinh-inputs/daily-plan/YYYY-MM-DD`) | Plan mode — Sinh's raw priorities for the day |
| Today's plan (`*-plan.md`) | Progress + End modes |
| Today's progress (`*-progress.md`) | End mode |

Daily files in: `~/Documents/ai-usage/daily/YYYY/MM/`
Sinh's inputs in: `~/Documents/ai-usage/sinh-inputs/daily-plan/`

**Important:** When creating the daily plan, always check `sinh-inputs/daily-plan/` for Sinh's confirmed priorities for the target date. These take precedence over auto-generated priorities from yesterday's summary.

```bash
ls ~/Documents/ai-usage/daily/$(date +%Y)/$(date +%m)/ 2>/dev/null
```

## Output

Write the document to the path specified in the mode instruction using the Write tool or bash. Create directories first:

```bash
mkdir -p ~/Documents/ai-usage/daily/$(date +%Y)/$(date +%m)
```

## Mode-Specific Guidelines

### PLAN mode
- Focus on actionable goals, not analysis
- Pull yesterday's "Tomorrow's Priorities" as starting goals — **first check whether a `YYYY-MM-DD-daily.md` exists for yesterday**. If not, add a visible note: `> **Note:** No end-of-day summary for yesterday — carry-forward items may be incomplete. Verify manually.`
- Include avo task list with priorities
- Time budgets should be realistic based on yesterday's actuals
- Keep it short — this is a morning kickoff, not a report

### PROGRESS mode
- Compare plan vs actual — what's on track, what's behind
- Be specific: "Goal 2 not started, 3h remaining in work day"
- Suggest adjustments if behind schedule
- Note new items that emerged (not in plan)

### END mode
- This is the comprehensive document — be thorough
- Track goal completion against the plan
- Include learnings from BOTH human and agent sessions
- Extract `## Self-Improvement` sections from agent session logs — these contain What/Why/How/Scope improvement suggestions. Aggregate them into a dedicated section in the daily summary so they're visible for review and action
- Deductions should reference specific data, not generic advice
- Compare with previous days if yesterday's summary exists
- "Tomorrow's Priorities" MUST be based on actual open items, not guesses
- Flag recurring issues (check if same issue appeared yesterday too)
- **When called from review mode**: you receive pre-gathered data from the gather phase PLUS Sinh's confirmed priorities. Use Sinh's priorities verbatim in "Tomorrow's Priorities" — do not override with auto-generated ones

## Rules

- Follow the document structure from the mode instruction exactly
- If a data source is missing, include the section with "No data available"
- Send completion message to team manager with file path and 3-line summary
- Be concise — the plan should be scannable in 1 min, progress in 2 min, end summary in 3 min
