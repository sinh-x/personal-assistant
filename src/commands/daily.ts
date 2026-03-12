import { readFileSync, writeFileSync, mkdirSync, unlinkSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { homedir, tmpdir } from "node:os";
import { loadConfig } from "../lib/config.js";
import { getHomeDir } from "../lib/paths.js";
import { deployCommand } from "./deploy.js";

/** Format date as YYYY-MM-DD */
function formatDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Build the plan objective */
function planObjective(today: string, year: string, month: string, outputDir: string): string {
  const inputNotes = resolve(homedir(), `Documents/ai-usage/sinh-inputs/daily-plan/${today}`);
  return `MODE: DAILY PLAN (morning) — SOLO (no sub-agents)
TARGET_DATE: ${today}

Create the daily plan for ${today}. You do this YOURSELF — do NOT spawn any sub-agents.

Workflow (you do all steps directly):
1. Check for user notes at ${inputNotes}
   - If the file exists, read it FIRST — these are Sinh's personal notes, priorities, or instructions for today
   - Incorporate these notes as HIGH PRIORITY items in the plan
   - The notes may contain specific goals, meetings, reminders, or overrides to the usual workflow
2. Read yesterday's daily summary (end-of-day) from ${outputDir}/ — look for the most recent *-daily.md
   - Extract 'Tomorrow's Priorities' as today's starting goals
   - Extract 'Open Items (Carried Forward)' as carryover todos
   - If no daily summary exists, check for recent session logs in ~/Documents/ai-usage/sessions/${year}/${month}/
3. Check your team inbox at ~/Documents/ai-usage/agent-teams/daily/inbox/
   - Read any files — these are context documents routed by the secretary
   - Incorporate relevant context into the plan
   - After processing, move each file to inbox/processed/
4. Get current avo task list and status:
   - Run: /home/sinh/.nix-profile/bin/avo task list
   - Run: /home/sinh/.nix-profile/bin/avo plan list
   - Run: /home/sinh/.nix-profile/bin/avo status
5. Use avo to plan the day's tasks:
   - Based on goals from steps 1-4, schedule tasks with avo:
     /home/sinh/.nix-profile/bin/avo plan add -t <task-id> -d <duration> -m <notes>
   - Prioritize P0 first, then P1, P2, etc.
   - Do not over-schedule — respect realistic time budget
   - If a goal has no matching avo task, note it for Sinh to create
6. Write the daily plan as a DRAFT for Sinh to review when he's ready

Output: ${homedir()}/Documents/ai-usage/sinh-inputs/inbox/${today}-plan-draft.md

IMPORTANT: This is a DRAFT — it runs at 05:00 before Sinh is awake.
- Save to sinh-inputs/inbox/ (NOT the daily folder) so Sinh finds it in his review queue
- Save as *-plan-draft.md (not -plan.md)
- Add a header: ## DRAFT — Review and adjust when ready
- Include a checklist at the top for quick review:
  - [ ] Goals look right
  - [ ] Time budget is realistic
  - [ ] No missing priorities
  - [ ] Avo plan looks right
- Add a ## Next Steps section at the bottom explaining:
  1. Review and adjust goals/time budget above
  2. Finalize by copying to ${outputDir}/${today}-plan.md (or ask pa to finalize)
  3. Optionally add notes for tomorrow at ${inputNotes} before going to bed
- Sinh will review this draft and finalize it himself

Plan document structure:
  ## User Notes (if ${inputNotes} exists)
  (Sinh's own notes for the day, verbatim or summarized)
  ## Today's Goals (from user notes + yesterday's priorities + new items)
  | # | Goal | Source | Priority |
  ## Avo Day Plan
  (output of avo plan list after scheduling)
  ## Time Budget
  | Category | Planned | Notes |
  ## Open Items Carried Forward
  - [ ] item (from session/date)
  ## Today's Task List
  (from avo task list, prioritized)
`;
}

/** Build the progress objective */
function progressObjective(today: string, outputDir: string): string {
  return `MODE: DAILY PROGRESS (mid-day)
TARGET_DATE: ${today}

Check progress toward the plan for ${today}.

Workflow:
1. Spawn session-gatherer, jsonl-analyst, and time-tracker IN PARALLEL
   - session-gatherer: read TODAY's sessions so far
   - jsonl-analyst: get today's JSONL stats so far
   - time-tracker: get avo current status, plan vs actual so far
2. Once all three are done, spawn synthesizer with their data and this instruction:
   - Read today's plan from ${outputDir}/${today}-plan.md
   - Compare planned goals vs actual activity
   - Produce a progress report

Output: ${outputDir}/${today}-progress.md

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
`;
}

const DAILY_DOC_STRUCTURE = `
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

  ## Self-Improvement (aggregated from agent sessions)
  Extracted from ## Self-Improvement sections in agent session logs

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
  Token usage, tool histogram, model distribution, projects, activity timeline`;

/** Phase 1: gather all data into team inbox (background, no synthesis) */
function endGatherObjective(today: string, outputDir: string): string {
  const inboxDir = `${homedir()}/Documents/ai-usage/agent-teams/daily/inbox`;
  const gatherReport = `${inboxDir}/${today}-end-gather.md`;
  const readyMarker = `${inboxDir}/${today}-end-ready.md`;

  return `MODE: DAILY END — PHASE 1: GATHER (background)
TARGET_DATE: ${today}

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
3. Read today's plan from ${outputDir}/${today}-plan.md (if exists) and compute goal completion
4. Write consolidated gather report to ${gatherReport}:

   ## Gather Report for ${today}
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

5. Write ready marker to ${readyMarker}:
   ready: true
   gathered_at: <ISO timestamp>
   gather_report: ${gatherReport}
   gaps_detected: true/false
   gap_count: N

Output: ${gatherReport} (gather report) + ${readyMarker} (ready marker)

After writing both files, log your session and exit.
`;
}

/** Phase 2: interactive review — read gathered data, reconcile time, confirm priorities, synthesize */
function endReviewObjective(today: string, outputDir: string): string {
  const inboxDir = `${homedir()}/Documents/ai-usage/agent-teams/daily/inbox`;
  const gatherReport = `${inboxDir}/${today}-end-gather.md`;
  const readyMarker = `${inboxDir}/${today}-end-ready.md`;

  return `MODE: DAILY END — PHASE 2: REVIEW (interactive)
TARGET_DATE: ${today}

Interactive end-of-day review: present gathered findings to Sinh, reconcile time tracking gaps, confirm tomorrow's priorities, then produce the final daily summary.

Workflow:
1. Check for gather report:
   - Read ${readyMarker} (check if gaps_detected: true/false)
   - Read ${gatherReport}
   - If NOT found: offer to run Phase 1 first OR proceed with live gather (spawn gatherers now)
2. Read today's plan from ${outputDir}/${today}-plan.md (if exists)
3. Present findings to Sinh — show a compact summary:
   === Daily End Review — ${today} ===
   Sessions: N | JSONL time: Xh | Tracked: Xh | Coverage: Z%
   Goals completed: N/M (XX%)
   Gaps detected: yes/no

   (Show untracked windows if any)

4. If tracking gaps exist, walk through them interactively:
   - For each untracked window, ask: "Window [HH:MM–HH:MM, Xh]: which task? (task ID or description, or 'skip')"
   - On task given: run /home/sinh/.nix-profile/bin/avo worklog add -t <task> -d <duration> -m "<description>"
   - Confirm: "Logged Xh to <task>"
   - Continue until all gaps resolved or Sinh says 'done' or 'skip all'

5. Show open items / carried-forward todos from gather report
   - Ask: "What are tomorrow's top priorities?" (offer data-driven suggestions)
   - Accept Sinh's input — these become the confirmed priorities

6. Once Sinh says "ready", "done", or "synthesize":
   - Spawn synthesizer with ALL gathered data + Sinh's confirmed priorities
   - Pass these inputs:
     a. Session report (from gather report)
     b. JSONL stats (from gather report)
     c. Avo report (from gather report, updated after any new worklogs)
     d. Sinh's confirmed priorities for tomorrow
   - Instruction to synthesizer: "Produce final daily summary. Tomorrow's Priorities = Sinh's confirmed list (not auto-generated). Include all data from gather report."

7. After synthesizer completes, clean up:
   - Move ${readyMarker} → ${inboxDir}/done/
   - Move ${gatherReport} → ${inboxDir}/done/

Output: ${outputDir}/${today}-daily.md
${DAILY_DOC_STRUCTURE}

Note: "Tomorrow's Priorities" section MUST use Sinh's confirmed priorities from Step 5, not auto-generated guesses.
`;
}

/** Interactive finalization of the plan draft */
function planReviewObjective(today: string, outputDir: string): string {
  const draftPath = `${homedir()}/Documents/ai-usage/sinh-inputs/inbox/${today}-plan-draft.md`;

  return `MODE: DAILY PLAN — REVIEW (interactive)
TARGET_DATE: ${today}

Finalize today's plan draft through interactive review with Sinh. You do this YOURSELF — do NOT spawn any sub-agents.

Workflow:
1. Check for draft at ${draftPath}
   - If found: read it and present it
   - If NOT found: check ${homedir()}/Documents/ai-usage/sinh-inputs/inbox/ for any *-plan-draft.md
   - If still not found: read yesterday's daily summary + current avo tasks and create a quick draft inline
2. Present the draft to Sinh section by section:
   - Show "## Today's Goals" — ask: "Do these goals look right? Anything to add or remove?"
   - Show "## Time Budget" — ask: "Is this realistic?"
   - Show any open items / carryovers
3. Accept corrections in plain conversation:
   - "change goal X" → update it
   - "add <goal>" → add to goals list
   - "adjust time for <category> to <amount>" → update time budget
   - "looks good" / "done" → proceed to finalize
4. Update avo plan if needed:
   - Run: /home/sinh/.nix-profile/bin/avo plan list (show current)
   - If Sinh wants changes: /home/sinh/.nix-profile/bin/avo plan add -t <task-id> -d <duration>
5. Write final plan to ${outputDir}/${today}-plan.md
6. If draft existed, move it: mv ${draftPath} ${homedir()}/Documents/ai-usage/sinh-inputs/done/
7. Confirm: "Plan finalized → ${outputDir}/${today}-plan.md"

Final plan document structure:
  ## Today's Goals
  | # | Goal | Source | Priority |
  ## Avo Day Plan
  (output of avo plan list after any changes)
  ## Time Budget
  | Category | Planned | Notes |
  ## Open Items Carried Forward
  - [ ] item (from session/date)
  ## Today's Task List
  (from avo task list, prioritized)
`;
}

/**
 * Daily lifecycle wrapper — sets the mode and deploys the daily team.
 * Replaces daily.sh (237 lines).
 */
export function dailyCommand(
  mode: string,
  args: string[]
): void {
  const config = loadConfig();
  const paHome = getHomeDir();

  // Validate mode
  if (!["plan", "progress", "end"].includes(mode)) {
    console.error(`Error: Unknown mode '${mode}'. Use: plan | progress | end`);
    process.exit(1);
  }

  // Parse remaining args: optional date + --review + optional deploy flag
  let targetDate = "";
  let isReview = false;
  let deployFlag = "";
  for (const arg of args) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(arg)) {
      targetDate = arg;
    } else if (arg === "--review") {
      isReview = true;
    } else {
      deployFlag = arg;
    }
  }

  const today = targetDate || formatDate(new Date());
  const year = today.slice(0, 4);
  const month = today.slice(5, 7);
  const outputDir = resolve(homedir(), `Documents/ai-usage/daily/${year}/${month}`);

  // Build mode-specific objective
  let objective: string;
  switch (mode) {
    case "plan":
      objective = isReview
        ? planReviewObjective(today, outputDir)
        : planObjective(today, year, month, outputDir);
      break;
    case "progress":
      objective = progressObjective(today, outputDir);
      break;
    case "end":
      objective = isReview
        ? endReviewObjective(today, outputDir)
        : endGatherObjective(today, outputDir);
      break;
    default:
      console.error(`Error: Unknown mode '${mode}'`);
      process.exit(1);
  }

  // Resolve daily.yaml: PA_CONFIG first, then PA_HOME
  let teamsDir: string;
  if (config.configDir && existsSync(resolve(config.configDir, "teams/daily.yaml"))) {
    teamsDir = resolve(config.configDir, "teams");
  } else {
    teamsDir = resolve(paHome, "teams");
  }

  const dailyYaml = resolve(teamsDir, "daily.yaml");
  if (!existsSync(dailyYaml)) {
    console.error(`Error: daily.yaml not found in ${teamsDir}`);
    process.exit(1);
  }

  // Build temp team file with injected objective
  const content = readFileSync(dailyYaml, "utf-8");
  // Strip everything from "objective:" onwards
  const lines = content.split("\n");
  const objectiveIdx = lines.findIndex((l) => l.startsWith("objective:"));
  const beforeObjective = objectiveIdx >= 0 ? lines.slice(0, objectiveIdx) : lines;

  const tempContent =
    beforeObjective.join("\n") +
    "\nobjective: |\n" +
    objective
      .split("\n")
      .map((l) => `  ${l}`)
      .join("\n") +
    "\n";

  // Write to temp file
  const tempDir = resolve(tmpdir(), "pa-daily");
  mkdirSync(tempDir, { recursive: true });
  const tmpFile = resolve(tempDir, `daily-${mode}-${Date.now()}.yaml`);
  writeFileSync(tmpFile, tempContent);

  // Build deploy opts
  // Review modes default to foreground; gather/plan/progress default to background
  const deployOpts: {
    dryRun?: boolean;
    background?: boolean;
    interactive?: boolean;
  } = {};

  if (!isReview && mode !== "progress") {
    deployOpts.background = true; // gather and plan run unattended
  }

  switch (deployFlag) {
    case "--dry-run":
      deployOpts.dryRun = true;
      break;
    case "--background":
      deployOpts.background = true;
      break;
    case "--interactive":
      deployOpts.interactive = true;
      break;
  }

  deployCommand(tmpFile, deployOpts);

  // Clean up temp file (non-critical)
  try {
    unlinkSync(tmpFile);
  } catch {
    // Best effort cleanup
  }
}
