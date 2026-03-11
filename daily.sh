#!/usr/bin/env bash
set -euo pipefail

# Daily lifecycle wrapper — sets the mode and deploys the daily team
#
# Usage: ./daily.sh <mode> [date] [--dry-run | --foreground | --interactive]
#
#   ./daily.sh plan                   — plan for today (background)
#   ./daily.sh plan --interactive     — plan interactively (you approve tool calls)
#   ./daily.sh end 2026-03-10        — end-of-day summary for a specific date
#   ./daily.sh progress --dry-run    — dry-run progress check for today

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PA_HOME="${PA_HOME:-$SCRIPT_DIR}"       # read-only base: teams/, skills/
PA_CONFIG=""                            # user overrides (set by pa-config.sh)
PA_DATA="${PA_DATA:-$PA_HOME}"          # mutable: primers/, logs/

# Load user config from ~/.config/sinh-x/personal-assistant/config.yaml
source "${PA_HOME}/pa-config.sh" 2>/dev/null || source "$SCRIPT_DIR/pa-config.sh" 2>/dev/null || true

# Resolve daily.yaml: PA_CONFIG first, then PA_HOME
if [[ -n "$PA_CONFIG" && -f "$PA_CONFIG/teams/daily.yaml" ]]; then
    TEAMS_DIR="$PA_CONFIG/teams"
else
    TEAMS_DIR="$PA_HOME/teams"
fi

mode="${1:?Usage: ./daily.sh <plan|progress|end> [YYYY-MM-DD] [--dry-run | --foreground]}"
shift

# Parse remaining args: optional date + optional flag
target_date=""
extra=""
for arg in "$@"; do
    if [[ "$arg" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]]; then
        target_date="$arg"
    else
        extra="$arg"
    fi
done

today="${target_date:-$(date +%Y-%m-%d)}"
year="${today:0:4}"
month="${today:5:2}"
output_dir="$HOME/Documents/ai-usage/daily/${year}/${month}"

# --- Mode-specific objectives ---

case "$mode" in
    plan)
        input_notes="$HOME/Documents/ai-usage/sinh-inputs/daily-plan/${today}"
        objective="MODE: DAILY PLAN (morning) — SOLO (no sub-agents)
TARGET_DATE: ${today}

Create the daily plan for ${today}. You do this YOURSELF — do NOT spawn any sub-agents.

Workflow (you do all steps directly):
1. Check for user notes at ${input_notes}
   - If the file exists, read it FIRST — these are Sinh's personal notes, priorities, or instructions for today
   - Incorporate these notes as HIGH PRIORITY items in the plan
   - The notes may contain specific goals, meetings, reminders, or overrides to the usual workflow
2. Read yesterday's daily summary (end-of-day) from ${output_dir}/ — look for the most recent *-daily.md
   - Extract 'Tomorrow's Priorities' as today's starting goals
   - Extract 'Open Items (Carried Forward)' as carryover todos
   - If no daily summary exists, check for recent session logs in ~/Documents/ai-usage/sessions/${year}/${month}/
3. Get current avo task list and status:
   - Run: /home/sinh/.nix-profile/bin/avo task list
   - Run: /home/sinh/.nix-profile/bin/avo plan list
   - Run: /home/sinh/.nix-profile/bin/avo status
4. Write the daily plan as a DRAFT for Sinh to review when he's ready

Output: ${output_dir}/${today}-plan-draft.md

IMPORTANT: This is a DRAFT — it runs at 05:00 before Sinh is awake.
- Save as *-plan-draft.md (not -plan.md)
- Add a header: ## DRAFT — Review and adjust when ready
- Include a checklist at the top for quick review:
  - [ ] Goals look right
  - [ ] Time budget is realistic
  - [ ] No missing priorities
- Sinh will review this draft and finalize it himself

Plan document structure:
  ## User Notes (if ${input_notes} exists)
  (Sinh's own notes for the day, verbatim or summarized)
  ## Today's Goals (from user notes + yesterday's priorities + new items)
  | # | Goal | Source | Priority |
  ## Time Budget
  | Category | Planned | Notes |
  ## Open Items Carried Forward
  - [ ] item (from session/date)
  ## Today's Task List
  (from avo task list, prioritized)
"
        ;;

    progress)
        objective="MODE: DAILY PROGRESS (mid-day)
TARGET_DATE: ${today}

Check progress toward the plan for ${today}.

Workflow:
1. Spawn session-gatherer, jsonl-analyst, and time-tracker IN PARALLEL
   - session-gatherer: read TODAY's sessions so far
   - jsonl-analyst: get today's JSONL stats so far
   - time-tracker: get avo current status, plan vs actual so far
2. Once all three are done, spawn synthesizer with their data and this instruction:
   - Read today's plan from ${output_dir}/${today}-plan.md
   - Compare planned goals vs actual activity
   - Produce a progress report

Output: ${output_dir}/${today}-progress.md

Progress document structure:
  ## Goal Progress
  | Goal | Status | Evidence | Notes |
  (Done / In Progress / Not Started / Blocked)
  ## Time Budget vs Actual (so far)
  | Category | Planned | Actual So Far | Remaining |
  ## Activity So Far
  - Sessions: N | Duration: Xh | Tool calls: N
  ## Adjustments
  - Goals to deprioritize (running out of time)
  - New items that emerged
  ## Remaining Plan
  - What to focus on for the rest of the day
"
        ;;

    end)
        objective="MODE: DAILY END (evening)
TARGET_DATE: ${today}

Produce the end-of-day summary for ${today} and plan for the next day.

Workflow:
1. Spawn session-gatherer, jsonl-analyst, and time-tracker IN PARALLEL
   - session-gatherer: read ALL of today's sessions (human + agent-team)
   - jsonl-analyst: get full day JSONL stats
   - time-tracker: get full day avo report
2. Once all three are done, spawn synthesizer with their data and this instruction:
   - Read today's plan from ${output_dir}/${today}-plan.md (if exists)
   - Read today's progress from ${output_dir}/${today}-progress.md (if exists)
   - Compare planned vs actual for the full day
   - Produce the final daily summary

Output: ${output_dir}/${today}-daily.md

Daily summary document structure:
  ## Day at a Glance
  | Metric | Value |
  (sessions, duration, tracked time, tool calls, done items, completion rate, teams deployed)

  ## Goal Completion
  | Goal | Status | Evidence |
  Goal completion: N/M (XX%)

  ## Time Tracking
  Plan vs actual by category, time gaps

  ## What Got Done
  ### Human Work (grouped by project)
  ### Agent Work (grouped by team)

  ## What I Learned
  ### From Human Sessions
  ### From Agent Teams
  ### Cross-Cutting Insights

  ## Deductions & Observations
  - Productivity patterns (peak hours, session lengths)
  - Tool & workflow insights
  - Recurring issues (across sessions and days)
  - Progress trends (vs previous days)

  ## Open Items (Carried Forward)
  Consolidated from all sessions

  ## Tomorrow's Priorities
  1. [ ] Priority — reasoning from today's data
  2. [ ] Priority — reasoning
  3. [ ] Priority — reasoning

  ## Stats Deep Dive
  Token usage, tool histogram, model distribution, projects, activity timeline
"
        ;;

    *)
        echo "Error: Unknown mode '$mode'. Use: plan | progress | end" >&2
        exit 1
        ;;
esac

# --- Build temp team file with injected objective (never mutate source) ---

tmp_team="$(mktemp --suffix=.yaml)"
trap 'rm -f "$tmp_team"' EXIT

sed "/^objective:/,\$d" "$TEAMS_DIR/daily.yaml" > "$tmp_team"
echo "objective: |" >> "$tmp_team"
echo "$objective" | sed 's/^/  /' >> "$tmp_team"

# --- Deploy using temp file path ---

deploy_cmd="${PA_BIN:+${PA_BIN}/pa-deploy}"
deploy_cmd="${deploy_cmd:-bash $SCRIPT_DIR/deploy.sh}"

if [[ "$extra" == "--dry-run" ]]; then
    $deploy_cmd "$tmp_team" --dry-run
elif [[ "$extra" == "--interactive" ]]; then
    $deploy_cmd "$tmp_team" --interactive
elif [[ "$extra" == "--foreground" ]]; then
    $deploy_cmd "$tmp_team" --foreground
else
    $deploy_cmd "$tmp_team"
fi
