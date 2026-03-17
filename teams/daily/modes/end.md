MODE: DAILY END — PHASE 1: GATHER (background)
TARGET_DATE: {{TODAY}}

Gather all end-of-day data autonomously. Write reports to team inbox. Do NOT produce the final daily summary — that happens in Phase 2 (pa daily end --review).

Workflow:
1. Spawn session-gatherer, jsonl-analyst, and time-tracker IN PARALLEL
   - session-gatherer: read ALL of today's sessions (human + agent-team)
   - jsonl-analyst: get full day JSONL stats
   - time-tracker: get full day avo report
2. Once all three report back, detect tracking gaps:
   - Compare total JSONL session duration vs avo tracked time
   - Gap = JSONL session time where no avo worklog entry covers that window
   - Flag as TRACKING GAP if untracked time > 30 min total
   - Build list of untracked windows: start_time, end_time, duration, which sessions were active
3. Read today's plan from {{OUTPUT_DIR}}/{{TODAY}}-plan.md (if exists) and compute goal completion
4. Write consolidated gather report to {{GATHER_REPORT}}:

   ## Gather Report for {{TODAY}}
   > Generated: <ISO timestamp>
   > Status: ready for review

   ### Session Summary
   (full output from session-gatherer)

   ### JSONL Stats
   (full output from jsonl-analyst)

   ### Time Tracking
   (full output from time-tracker)

   ### Gap Analysis
   - Total JSONL session time: Xh Ym
   - Total avo tracked time: Xh Ym
   - Coverage: Z%
   - Gaps detected: yes/no

   #### Untracked Windows
   | Start | End | Duration | Sessions Active |
   |-------|-----|----------|-----------------|
   (list each gap — omit table if no gaps)

   ### Goal Completion (preliminary)
   (compare today's plan goals vs session done items — if plan exists)

5. Write ready marker to {{READY_MARKER}}:
   ready: true
   gathered_at: <ISO timestamp>
   gather_report: {{GATHER_REPORT}}
   gaps_detected: true/false
   gap_count: N

6. Trigger secretary to generate the daily progress board:
   - Create directory if needed: ~/Documents/ai-usage/agent-teams/secretary/inbox/
   - Only write if file does not already exist (idempotent — skip if already triggered today)
   - Write trigger file: ~/Documents/ai-usage/agent-teams/secretary/inbox/{{TODAY}}-daily-end-trigger.md

   Content to write:
   # Daily Progress Board Request: {{TODAY}}

   > **Date:** {{TODAY}}
   > **From:** daily / team-manager
   > **Type:** trigger

   Daily-end gather complete. Please generate the daily progress board and update project tracking.

   ## What to Do

   Follow your collect.md skill to:
   1. Scan evidence (deployments, sessions, done/) for today
   2. Write: ~/Documents/ai-usage/daily/{{YEAR}}/{{MONTH}}/{{TODAY}}-progress.md
   3. Update: ~/Documents/ai-usage/insights/projects/<project>.md for each project touched
   4. Run orphan directory scan and cleanup

   ## Inputs Available

   - Gather report: {{GATHER_REPORT}}
   - Ready marker: {{READY_MARKER}}

Output: {{GATHER_REPORT}} (gather report) + {{READY_MARKER}} (ready marker) + secretary trigger

After writing all files, log your session and exit.
